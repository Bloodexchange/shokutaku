'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const COOKIE = 'shk_sid';
const ADMIN_COOKIE = 'shk_admin';
const USER_TTL = 30 * 24 * 3600; // 30 дней
const ADMIN_TTL = 12 * 3600; // 12 часов

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET не задан (минимум 16 символов)');
  return s;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function login(res, user) {
  setCookie(res, COOKIE, sign({ uid: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + USER_TTL }), USER_TTL);
}
function logout(res) { setCookie(res, COOKIE, '', 0); }

function adminLogin(res) {
  setCookie(res, ADMIN_COOKIE, sign({ admin: true, exp: Math.floor(Date.now() / 1000) + ADMIN_TTL }), ADMIN_TTL);
}
function adminLogout(res) { setCookie(res, ADMIN_COOKIE, '', 0); }

/** Подгружает req.user (если вошёл) и req.isAdmin. */
async function attach(req, _res, next) {
  try {
    const cookies = parseCookies(req);
    const s = verify(cookies[COOKIE]);
    if (s && s.uid) {
      const { rows } = await db.query('SELECT id, phone, role, name FROM users WHERE id=$1', [s.uid]);
      req.user = rows[0] || null;
    }
    const a = verify(cookies[ADMIN_COOKIE]);
    req.isAdmin = !!(a && a.admin);
    next();
  } catch (e) {
    next(e);
  }
}

function requireUser(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Нужно войти в аккаунт' });
    if (role && req.user.role !== role) return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(401).json({ error: 'Требуется вход администратора' });
  next();
}

/** Проверка логина/пароля администратора (пароль хранится только как bcrypt‑хеш). */
async function checkAdminCredentials(loginName, password) {
  const expectedLogin = process.env.ADMIN_LOGIN;
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!expectedLogin || !hash) return false;
  const loginOk = typeof loginName === 'string' && loginName.trim() === expectedLogin;
  const passOk = typeof password === 'string' && (await bcrypt.compare(password, hash));
  return loginOk && passOk;
}

/** Простая защита от перебора: не больше `limit` неудачных попыток за 15 минут. */
async function tooManyAttempts(key, limit = 8) {
  await db.query("DELETE FROM login_attempts WHERE created_at < now() - interval '1 day'");
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM login_attempts WHERE key=$1 AND created_at > now() - interval '15 minutes'",
    [key]
  );
  return rows[0].n >= limit;
}
async function recordFailure(key) {
  await db.query('INSERT INTO login_attempts(key) VALUES ($1)', [key]);
}
async function clearFailures(key) {
  await db.query('DELETE FROM login_attempts WHERE key=$1', [key]);
}

module.exports = {
  attach, requireUser, requireAdmin, login, logout, adminLogin, adminLogout,
  checkAdminCredentials, tooManyAttempts, recordFailure, clearFailures,
};
