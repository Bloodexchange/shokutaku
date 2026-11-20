'use strict';
const path = require('path');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('./db');
const auth = require('./auth');
const tg = require('./telegram');
const gemini = require('./gemini');
const orders = require('./orders');
const { CATEGORIES, CATEGORY_LABELS, normalizeCity } = require('./constants');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '200kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

const MAX_FILE = 4 * 1024 * 1024; // лимит тела запроса Vercel ~4.5 МБ
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.includes(file.mimetype)),
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

/* ----------------------------- helpers ----------------------------- */

function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 9) d = '998' + d; // местный узбекский номер без кода
  if (d.length < 10 || d.length > 15) return null;
  if (d.startsWith('998') && d.length !== 12) return null;
  return '+' + d;
}

function str(v, max = 500) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw bad('Пароль должен содержать минимум 8 символов');
  if (p.length > 128) throw bad('Слишком длинный пароль');
}

function ageFrom(dateStr) {
  const b = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(b.getTime())) return null;
  const n = new Date();
  let age = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) age--;
  return age;
}

function publicUser(u) {
  return u ? { id: u.id, phone: u.phone, role: u.role, name: u.name } : null;
}

const CONF_SELECT = `
  SELECT c.user_id AS id, c.full_name AS name, c.city, c.experience_years AS experience,
         c.specialties, c.signature_dishes AS dishes, c.workplace, c.about,
         (c.certificate_file IS NOT NULL) AS certificate, c.created_at,
         COALESCE(r.avg, 0)::float AS rating, COALESCE(r.cnt, 0)::int AS reviews,
         COALESCE(o.done, 0)::int AS orders_done,
         (c.address IS NOT NULL OR c.lat IS NOT NULL) AS has_address
  FROM confectioners c
  LEFT JOIN (SELECT confectioner_id, avg(rating) AS avg, count(*) AS cnt FROM reviews GROUP BY confectioner_id) r
         ON r.confectioner_id = c.user_id
  LEFT JOIN (SELECT confectioner_id, count(*) AS done FROM orders WHERE status='done' GROUP BY confectioner_id) o
         ON o.confectioner_id = c.user_id`;

/** Координаты точки на карте из запроса (или null). */
function point(lat, lon) {
  const a = Number(lat), b = Number(lon);
  if (lat === '' || lat == null || lon === '' || lon == null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6];
}

/** Расстояние по прямой, км. */
function distanceKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null)) return null;
  const r = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

function shapeConf(row) {
  return {
    ...row,
    rating: Math.round(row.rating * 10) / 10,
    specialty_labels: (row.specialties || []).map((s) => CATEGORY_LABELS[s] || s),
  };
}

/* ----------------------------- public ----------------------------- */

// Telegram вебхук — до auth.attach, чтобы не трогать куки.
app.post('/api/telegram/webhook', wrap(async (req, res) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && req.get('X-Telegram-Bot-Api-Secret-Token') !== expected) return res.sendStatus(401);
  try {
    await tg.handleUpdate(req.body || {});
  } catch (e) {
    console.error('Ошибка обработки апдейта Telegram', e);
  }
  res.json({ ok: true });
}));

app.use('/api', auth.attach);

// Ключ JavaScript API Яндекс Карт (публичный, виден в браузере). Можно заменить переменной YANDEX_MAPS_KEY.
const DEFAULT_YMAPS_KEY = '5771415d-001f-4699-b102-0fb2f6af965a';

app.get('/api/meta', wrap(async (_req, res) => {
  const s = await db.getSettings();
  res.json({
    categories: CATEGORIES.map(([key, label]) => ({ key, label })),
    ai: gemini.enabled(),
    commission_percent: Number(s.commission_percent) || 0,
    yandex_maps_key: process.env.YANDEX_MAPS_KEY || DEFAULT_YMAPS_KEY,
  });
}));

app.get('/api/me', wrap(async (req, res) => {
  let confectioner = null;
  if (req.user && req.user.role === 'confectioner') {
    const { rows } = await db.query('SELECT status FROM confectioners WHERE user_id=$1', [req.user.id]);
    confectioner = rows[0] || null;
  }
  res.json({ user: publicUser(req.user), confectioner });
}));

app.post('/api/auth/register-client', wrap(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) throw bad('Введите корректный номер телефона, например +998 90 123 45 67');
  validatePassword(req.body.password);
  const name = str(req.body.name, 80) || null;
  const hash = await bcrypt.hash(req.body.password, 10);
  const r = await db.query(
    "INSERT INTO users(phone, password_hash, role, name) VALUES ($1,$2,'client',$3) ON CONFLICT (phone) DO NOTHING RETURNING id, phone, role, name",
    [phone, hash, name]
  );
  if (!r.rows[0]) throw new HttpError(409, 'Этот номер уже зарегистрирован. Войдите в аккаунт.');
  auth.login(res, r.rows[0]);
  tg.notifyAdmins(`👤 <b>Новый заказчик #${r.rows[0].id}</b>\nИмя: ${tg.esc(name || '—')}\nТелефон: ${tg.esc(phone)}`).catch(() => {});
  res.status(201).json({ user: publicUser(r.rows[0]) });
}));

app.post('/api/auth/register-confectioner', upload.single('certificate'), wrap(async (req, res) => {
  const b = req.body || {};
  const phone = normalizePhone(b.phone);
  if (!phone) throw bad('Введите корректный номер телефона, например +998 90 123 45 67');
  validatePassword(b.password);
  const fullName = str(b.full_name, 100);
  if (fullName.length < 2) throw bad('Укажите имя и фамилию');
  const birth = str(b.birth_date, 10);
  const age = /^\d{4}-\d{2}-\d{2}$/.test(birth) ? ageFrom(birth) : null;
  if (age === null || age > 100) throw bad('Укажите корректную дату рождения');
  if (age < 15) throw bad('Регистрация кондитеров доступна с 15 лет');
  let parentName = null;
  let parentPhone = null;
  if (age < 18) {
    parentName = str(b.parent_name, 100);
    parentPhone = normalizePhone(b.parent_phone);
    if (parentName.length < 2) throw bad('Кондитерам младше 18 лет нужно указать имя одного из родителей');
    if (!parentPhone) throw bad('Укажите корректный телефон родителя');
  }
  const exp = Number(b.experience_years);
  if (!Number.isInteger(exp) || exp < 0 || exp > 80) throw bad('Укажите стаж в годах (целое число)');
  if (exp > age - 10) throw bad('Стаж не может быть больше, чем позволяет возраст');
  let specialties = b.specialties;
  if (typeof specialties === 'string') {
    try { specialties = JSON.parse(specialties); } catch { specialties = specialties.split(','); }
  }
  specialties = [...new Set((Array.isArray(specialties) ? specialties : []).map(String))].filter((s) => CATEGORY_LABELS[s]);
  if (!specialties.length) throw bad('Выберите хотя бы одно направление');
  const dishes = str(b.signature_dishes, 600);
  if (dishes.length < 3) throw bad('Напишите, какие блюда вы готовите лучше всего');
  if (b.terms !== 'true' && b.terms !== true && b.terms !== 'on') throw bad('Нужно принять условия пользования для кондитеров');
  if (req.file === undefined && b.has_certificate_file === 'true') throw bad('Сертификат: допустимы PDF, JPG, PNG, WEBP или HEIC до 4 МБ');

  const client = await db.getPool().connect();
  try {
    await db.migrate();
    await client.query('BEGIN');
    const hash = await bcrypt.hash(b.password, 10);
    const u = await client.query(
      "INSERT INTO users(phone, password_hash, role, name) VALUES ($1,$2,'confectioner',$3) ON CONFLICT (phone) DO NOTHING RETURNING id, phone, role, name",
      [phone, hash, fullName]
    );
    if (!u.rows[0]) throw new HttpError(409, 'Этот номер уже зарегистрирован. Войдите в аккаунт.');
    const user = u.rows[0];
    let fileId = null;
    if (req.file) {
      const f = await client.query(
        'INSERT INTO files(user_id, name, mime, size, data) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [user.id, str(req.file.originalname, 120) || 'certificate', req.file.mimetype, req.file.size, req.file.buffer]
      );
      fileId = f.rows[0].id;
    }
    await client.query(
      `INSERT INTO confectioners(user_id, full_name, birth_date, parent_name, parent_phone, city, experience_years,
         workplace, specialties, signature_dishes, about, certificate_file, terms_accepted_at, address, lat, lon)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), $13, $14, $15)`,
      [user.id, fullName, birth, parentName, parentPhone, normalizeCity(str(b.city, 60)) || null, exp,
        str(b.workplace, 300) || null, specialties, dishes, str(b.about, 1000) || null, fileId,
        str(b.address, 300) || null, ...(point(b.lat, b.lon) || [null, null])]
    );
    await client.query('COMMIT');
    auth.login(res, user);
    try {
      await tg.notifyNewApplication(user.id); // анкета уходит в Telegram администратору
    } catch (e) {
      console.error('Не удалось отправить анкету в Telegram', e);
    }
    res.status(201).json({ user: publicUser(user), status: 'pending' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const key = `web:${phone || 'x'}`;
  if (await auth.tooManyAttempts(key)) throw new HttpError(429, 'Слишком много попыток входа. Попробуйте через 15 минут.');
  const { rows } = phone ? await db.query('SELECT * FROM users WHERE phone=$1', [phone]) : { rows: [] };
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) {
    await auth.recordFailure(key);
    throw new HttpError(401, 'Неверный номер телефона или пароль');
  }
  await auth.clearFailures(key);
  auth.login(res, user);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', (req, res) => {
  auth.logout(res);
  res.json({ ok: true });
});

app.post('/api/auth/change-password', auth.requireUser(), wrap(async (req, res) => {
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body.old_password || ''), rows[0].password_hash))) throw bad('Текущий пароль неверный');
  validatePassword(req.body.new_password);
  await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user.id, await bcrypt.hash(req.body.new_password, 10)]);
  res.json({ ok: true });
}));

/* ----------------------------- catalog ----------------------------- */

app.get('/api/confectioners', wrap(async (req, res) => {
  const where = ["c.status='approved'"];
  const params = [];
  const q = str(req.query.q, 100);
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`);
    where.push(`(c.full_name ILIKE $${params.length} OR c.signature_dishes ILIKE $${params.length}
      OR c.workplace ILIKE $${params.length} OR c.about ILIKE $${params.length} OR c.city ILIKE $${params.length})`);
  }
  const cats = str(req.query.cat, 400).split(',').filter((c) => CATEGORY_LABELS[c]);
  if (cats.length) { params.push(cats); where.push(`c.specialties && $${params.length}::text[]`); }
  const minExp = Number(req.query.minExp);
  if (minExp > 0) { params.push(minExp); where.push(`c.experience_years >= $${params.length}`); }
  if (req.query.cert === '1') where.push('c.certificate_file IS NOT NULL');
  const city = normalizeCity(str(req.query.city, 60));
  if (city) { params.push(city); where.push(`c.city ILIKE $${params.length}`); }
  const sorts = {
    rating: 'rating DESC, experience DESC',
    experience: 'experience DESC',
    new: 'c.created_at DESC',
  };
  const order = sorts[req.query.sort] || sorts.rating;
  const { rows } = await db.query(`${CONF_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`, params);
  res.json({ items: rows.map(shapeConf) });
}));

app.get('/api/confectioners/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(404, 'Кондитер не найден');
  const { rows } = await db.query(`${CONF_SELECT} WHERE c.status='approved' AND c.user_id=$1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Кондитер не найден');
  const reviews = await db.query(
    `SELECT r.rating, r.text, r.created_at, COALESCE(u.name, 'Заказчик') AS author
     FROM reviews r JOIN users u ON u.id=r.client_id WHERE r.confectioner_id=$1 ORDER BY r.created_at DESC LIMIT 30`,
    [id]
  );
  res.json({ item: shapeConf(rows[0]), reviews: reviews.rows });
}));

/* ----------------------------- AI search ----------------------------- */

app.post('/api/ai/match', wrap(async (req, res) => {
  if (!gemini.enabled()) throw new HttpError(503, 'ИИ‑поиск пока не настроен');
  const query = str(req.body.query, 500);
  const dish = str(req.body.dish, 100);
  const components = (Array.isArray(req.body.components) ? req.body.components : String(req.body.components || '').split(','))
    .map((s) => str(s, 60)).filter(Boolean).slice(0, 20);
  if (!query && !dish && !components.length) throw bad('Опишите, что вы хотите заказать');
  const lang = (req.get('x-shk-lang') || req.body.lang) === 'uz' ? 'uz' : 'ru';

  const key = `ai:${req.ip}`;
  if (await auth.tooManyAttempts(key, 30)) throw new HttpError(429, 'Слишком много запросов к ИИ. Подождите немного.');
  await auth.recordFailure(key); // используем как счётчик запросов

  const { rows } = await db.query(`${CONF_SELECT} WHERE c.status='approved' ORDER BY rating DESC LIMIT 150`);
  const all = rows.map(shapeConf);
  try {
    if (!all.length) {
      const a = await gemini.analyzeRequest([query, dish, components.join(', ')].filter(Boolean).join('. '), lang);
      return res.json({ summary: a.tips || '', detected: { dish: a.dish, categories: a.categories || [] }, matches: [], items: [] });
    }
    const result = await gemini.matchConfectioners({ query, dish, components, lang }, all);
    const byId = new Map(all.map((c) => [c.id, c]));
    res.json({
      summary: result.summary,
      detected: result.detected,
      matches: result.matches,
      items: result.matches.map((m) => ({ ...byId.get(m.id), ai_score: m.score, ai_reason: m.reason })),
    });
  } catch (e) {
    console.error('Gemini error', e.message);
    // Запасной вариант без ИИ: простой поиск по словам
    const words = [query, dish, ...components].join(' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
    const scored = all.map((c) => {
      const hay = [c.name, c.dishes, c.about, c.workplace, ...c.specialty_labels].join(' ').toLowerCase();
      const hits = words.filter((w) => hay.includes(w.slice(0, Math.max(4, w.length - 2)))).length;
      return { ...c, ai_score: Math.min(100, hits * 25 + c.experience * 2), ai_reason: hits ? 'Совпадение по ключевым словам' : '' };
    }).filter((c) => c.ai_reason).sort((a, b) => b.ai_score - a.ai_score).slice(0, 6);
    res.json({ summary: 'ИИ сейчас перегружен, показали подбор по ключевым словам.', fallback: true, matches: [], items: scored });
  }
}));

/* ----------------------------- orders ----------------------------- */

app.post('/api/orders', auth.requireUser('client'), wrap(async (req, res) => {
  const confId = Number(req.body.confectioner_id);
  const conf = await db.query("SELECT full_name FROM confectioners WHERE user_id=$1 AND status='approved'", [confId]);
  if (!conf.rows[0]) throw bad('Кондитер не найден');
  const dish = str(req.body.dish, 150);
  if (dish.length < 2) throw bad('Укажите, какое блюдо нужно');
  const date = str(req.body.event_date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Неверная дата');
  if (date && new Date(date) < new Date(new Date().toDateString())) throw bad('Дата не может быть в прошлом');
  const delivery = req.body.delivery_type === 'delivery' ? 'delivery' : 'pickup';
  const dAddress = delivery === 'delivery' ? str(req.body.delivery_address, 300) : '';
  const dPoint = delivery === 'delivery' ? point(req.body.delivery_lat, req.body.delivery_lon) : null;
  const dDetails = delivery === 'delivery' ? str(req.body.delivery_details, 200) : '';
  if (delivery === 'delivery' && dAddress.length < 5) throw bad('Укажите адрес доставки на карте или текстом');
  const open = await db.query("SELECT count(*)::int AS n FROM orders WHERE client_id=$1 AND status='new'", [req.user.id]);
  if (open.rows[0].n >= 10) throw bad('У вас слишком много необработанных заявок');
  const { rows } = await db.query(
    `INSERT INTO orders(client_id, confectioner_id, dish, components, event_date, budget, comment,
       delivery_type, delivery_address, delivery_details, delivery_lat, delivery_lon)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [req.user.id, confId, dish, str(req.body.components, 500) || null, date || null, str(req.body.budget, 60) || null, str(req.body.comment, 1000) || null,
      delivery, dAddress || null, dDetails || null, ...(dPoint || [null, null])]
  );
  const getting = delivery === 'delivery' ? `🚚 Доставка: ${tg.esc(dAddress)}${dDetails ? ', ' + tg.esc(dDetails) : ''}` : '🏃 Самовывоз';
  tg.notifyAdmins(`🛎 <b>Новая заявка #${rows[0].id}</b>\n${tg.esc(dish)} → ${tg.esc(conf.rows[0].full_name)}\nЗаказчик: ${tg.esc(req.user.name || '—')}, ${tg.esc(req.user.phone)}\n${getting}`)
    .catch(() => {});
  res.status(201).json({ id: rows[0].id });
}));

app.get('/api/orders', auth.requireUser(), wrap(async (req, res) => {
  const mine = req.user.role === 'client' ? 'o.client_id' : 'o.confectioner_id';
  const { rows } = await db.query(
    `SELECT o.*, c.full_name AS confectioner_name, cu.phone AS confectioner_phone,
            c.address AS confectioner_address, c.lat AS confectioner_lat, c.lon AS confectioner_lon,
            COALESCE(u.name, 'Заказчик') AS client_name, u.phone AS client_phone,
            (r.id IS NOT NULL) AS reviewed
     FROM orders o
     JOIN confectioners c ON c.user_id=o.confectioner_id
     JOIN users cu ON cu.id=o.confectioner_id
     JOIN users u ON u.id=o.client_id
     LEFT JOIN reviews r ON r.order_id=o.id
     WHERE ${mine}=$1 ORDER BY o.created_at DESC LIMIT 200`,
    [req.user.id]
  );
  // Контакты открываются только после оплаты заказа через сайт.
  const items = rows.map((o) => {
    const reveal = ['paid', 'done'].includes(o.status);
    const { receipt_file, confectioner_address, confectioner_lat, confectioner_lon, ...rest } = o;
    const isDelivery = o.delivery_type === 'delivery';
    // Точный адрес доставки и адрес кондитера тоже видны только после оплаты.
    const hidden = { delivery_address: null, delivery_details: null, delivery_lat: null, delivery_lon: null };
    return {
      ...rest,
      ...(reveal || req.user.role === 'client' ? {} : hidden),
      distance_km: req.user.role === 'confectioner' && isDelivery ? distanceKm(confectioner_lat, confectioner_lon, o.delivery_lat, o.delivery_lon) : null,
      pickup_address: reveal && !isDelivery && (confectioner_address || confectioner_lat != null)
        ? { address: confectioner_address, lat: confectioner_lat, lon: confectioner_lon } : null,
      has_receipt: !!receipt_file,
      payout_amount: req.user.role === 'confectioner' ? orders.payoutAmount(o) : undefined,
      confectioner_phone: reveal ? o.confectioner_phone : null,
      client_phone: reveal ? o.client_phone : null,
    };
  });
  res.json({ items });
}));

const TRANSITIONS = {
  confectioner: { new: ['accepted', 'declined'], accepted: ['declined'], paid: ['done'] },
  client: { new: ['cancelled'], accepted: ['cancelled'] },
};

app.patch('/api/orders/:id', auth.requireUser(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const col = req.user.role === 'client' ? 'client_id' : 'confectioner_id';
  const { rows } = await db.query(`SELECT * FROM orders WHERE id=$1 AND ${col}=$2`, [id, req.user.id]);
  const order = rows[0];
  if (!order) throw new HttpError(404, 'Заявка не найдена');
  if (req.user.role === 'confectioner') {
    const st = await db.query('SELECT status FROM confectioners WHERE user_id=$1', [req.user.id]);
    if (st.rows[0]?.status !== 'approved') throw new HttpError(403, 'Анкета ещё не одобрена');
  }
  const next = String(req.body.status || '');
  if (!(TRANSITIONS[req.user.role][order.status] || []).includes(next)) throw bad('Нельзя изменить статус заявки');
  if (order.payment_status === 'review' && ['declined', 'cancelled'].includes(next)) {
    throw bad('Оплата по заявке на проверке. Дождитесь решения администратора.');
  }
  if (next === 'accepted') {
    const price = Math.round(Number(String(req.body.price || '').replace(/\s/g, '')));
    if (!Number.isFinite(price) || price < 1000 || price > 1_000_000_000) throw bad('Укажите цену заказа в сумах (от 1 000)');
    const { commission_percent } = await db.getSettings();
    await db.query(
      "UPDATE orders SET status='accepted', price=$2, commission_percent=$3, updated_at=now() WHERE id=$1",
      [id, price, Number(commission_percent) || 0]
    );
  } else if (next === 'done') {
    await db.query(
      `UPDATE orders SET status='done', payout_status=CASE WHEN dispute_status='open' THEN 'hold' ELSE 'due' END, updated_at=now() WHERE id=$1`,
      [id]
    );
    const o = await orders.load(id);
    tg.notifyAdmins(`📦 Заказ #${id} выполнен. К выплате кондитеру ${tg.esc(o.confectioner_name)}: <b>${orders.fmt(orders.payoutAmount(o))} сум</b>`).catch(() => {});
  } else {
    await db.query('UPDATE orders SET status=$2, updated_at=now() WHERE id=$1', [id, next]);
  }
  res.json({ ok: true });
}));

/* ----------------------------- payment ----------------------------- */

async function clientOrder(req) {
  const { rows } = await db.query('SELECT * FROM orders WHERE id=$1 AND client_id=$2', [Number(req.params.id), req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'Заявка не найдена');
  return rows[0];
}

app.get('/api/orders/:id/payment', auth.requireUser('client'), wrap(async (req, res) => {
  const o = await clientOrder(req);
  if (o.status !== 'accepted' || !o.price) throw bad('Заказ сейчас нельзя оплатить');
  const s = await db.getSettings();
  res.json({
    amount: Number(o.price),
    payment_status: o.payment_status,
    card: s.payment_card ? { number: s.payment_card, holder: s.payment_card_holder || '' } : null,
    admin_note: o.admin_note,
  });
}));

app.post('/api/orders/:id/receipt', auth.requireUser('client'), upload.single('receipt'), wrap(async (req, res) => {
  const o = await clientOrder(req);
  if (o.status !== 'accepted' || !o.price || o.payment_status === 'paid') throw bad('Заказ сейчас нельзя оплатить');
  if (!req.file) throw bad('Прикрепите чек: фото или PDF до 4 МБ');
  const f = await db.query(
    'INSERT INTO files(user_id, name, mime, size, data) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [req.user.id, str(req.file.originalname, 120) || 'receipt', req.file.mimetype, req.file.size, req.file.buffer]
  );
  await db.query(
    "UPDATE orders SET payment_status='review', payment_method='card', receipt_file=$2, admin_note=NULL, updated_at=now() WHERE id=$1",
    [o.id, f.rows[0].id]
  );
  try { await tg.notifyPaymentReview(o.id); } catch (e) { console.error('Telegram receipt', e); }
  res.json({ ok: true });
}));

app.post('/api/orders/:id/dispute', auth.requireUser('client'), wrap(async (req, res) => {
  const o = await clientOrder(req);
  if (!['paid', 'done'].includes(o.status) || o.payout_status === 'paid') throw bad('Жалобу можно открыть только по оплаченному заказу до выплаты кондитеру');
  const text = str(req.body.text, 1000);
  if (text.length < 10) throw bad('Опишите проблему подробнее (от 10 символов)');
  await db.query(
    `UPDATE orders SET dispute_status='open', dispute_text=$2, payout_status=CASE WHEN payout_status='due' THEN 'hold' ELSE payout_status END, updated_at=now() WHERE id=$1`,
    [o.id, text]
  );
  tg.notifyAdmins(`⚠️ <b>Жалоба по заказу #${o.id}</b>\n${tg.esc(text)}\n\nРешение: админ‑панель → Оплата и заказы.`).catch(() => {});
  res.json({ ok: true });
}));

app.put('/api/cabinet/payout', auth.requireUser('confectioner'), wrap(async (req, res) => {
  const card = String(req.body.card || '').replace(/\D/g, '');
  if (card.length !== 16) throw bad('Номер карты должен содержать 16 цифр');
  await db.query('UPDATE confectioners SET payout_card=$2, payout_holder=$3 WHERE user_id=$1', [req.user.id, card, str(req.body.holder, 80) || null]);
  res.json({ ok: true });
}));

app.post('/api/orders/:id/review', auth.requireUser('client'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await db.query("SELECT * FROM orders WHERE id=$1 AND client_id=$2 AND status='done'", [id, req.user.id]);
  if (!rows[0]) throw bad('Отзыв можно оставить только по выполненному заказу');
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad('Оценка от 1 до 5');
  await db.query(
    'INSERT INTO reviews(order_id, confectioner_id, client_id, rating, text) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO NOTHING',
    [id, rows[0].confectioner_id, req.user.id, rating, str(req.body.text, 1000) || null]
  );
  res.status(201).json({ ok: true });
}));

/* ----------------------------- confectioner cabinet ----------------------------- */

app.get('/api/cabinet/profile', auth.requireUser('confectioner'), wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT full_name, birth_date::text, city, experience_years, workplace, specialties, signature_dishes, about, address, lat, lon,
            (certificate_file IS NOT NULL) AS certificate, status, admin_note, created_at,
            CASE WHEN payout_card IS NOT NULL THEN '•••• ' || right(payout_card, 4) END AS payout_card_masked, payout_holder
     FROM confectioners WHERE user_id=$1`,
    [req.user.id]
  );
  res.json({ profile: rows[0] || null });
}));

app.put('/api/cabinet/profile', auth.requireUser('confectioner'), wrap(async (req, res) => {
  const b = req.body || {};
  const exp = Number(b.experience_years);
  if (!Number.isInteger(exp) || exp < 0 || exp > 80) throw bad('Укажите стаж в годах');
  const specialties = [...new Set((Array.isArray(b.specialties) ? b.specialties : []).map(String))].filter((s) => CATEGORY_LABELS[s]);
  if (!specialties.length) throw bad('Выберите хотя бы одно направление');
  await db.query(
    `UPDATE confectioners SET city=$2, experience_years=$3, workplace=$4, specialties=$5, signature_dishes=$6, about=$7,
       address=$8, lat=$9, lon=$10, updated_at=now()
     WHERE user_id=$1`,
    [req.user.id, normalizeCity(str(b.city, 60)) || null, exp, str(b.workplace, 300) || null, specialties, str(b.signature_dishes, 600), str(b.about, 1000) || null,
      str(b.address, 300) || null, ...(point(b.lat, b.lon) || [null, null])]
  );
  tg.notifyAdmins(`✏️ Кондитер #${req.user.id} обновил анкету. Посмотреть: /pending или в админ‑панели.`).catch(() => {});
  res.json({ ok: true });
}));

/* ----------------------------- admin ----------------------------- */

app.post('/api/admin/login', wrap(async (req, res) => {
  const key = `admin:${req.ip}`;
  if (await auth.tooManyAttempts(key, 5)) throw new HttpError(429, 'Слишком много попыток. Попробуйте через 15 минут.');
  if (!(await auth.checkAdminCredentials(req.body.login, req.body.password))) {
    await auth.recordFailure(key);
    throw new HttpError(401, 'Неверный логин или пароль');
  }
  await auth.clearFailures(key);
  auth.adminLogin(res);
  res.json({ ok: true });
}));

app.post('/api/admin/logout', (req, res) => { auth.adminLogout(res); res.json({ ok: true }); });
app.get('/api/admin/me', (req, res) => res.json({ admin: !!req.isAdmin }));

app.get('/api/admin/stats', auth.requireAdmin, wrap(async (_req, res) => {
  const { rows } = await db.query(`SELECT
    (SELECT count(*) FROM users WHERE role='client')::int AS clients,
    (SELECT count(*) FROM confectioners WHERE status='approved')::int AS approved,
    (SELECT count(*) FROM confectioners WHERE status='pending')::int AS pending,
    (SELECT count(*) FROM confectioners WHERE status='rejected')::int AS rejected,
    (SELECT count(*) FROM orders)::int AS orders,
    (SELECT count(*) FROM orders WHERE payment_status='review')::int AS payments_review,
    (SELECT count(*) FROM orders WHERE payout_status IN ('due','hold'))::int AS payouts_due,
    (SELECT count(*) FROM admin_chats)::int AS telegram_admins`);
  res.json(rows[0]);
}));

app.get('/api/admin/applications', auth.requireAdmin, wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await db.query(
    `SELECT c.*, c.birth_date::text AS birth_date, u.phone FROM confectioners c JOIN users u ON u.id=c.user_id
     ${status ? 'WHERE c.status=$1' : ''} ORDER BY c.created_at DESC LIMIT 300`,
    status ? [status] : []
  );
  res.json({ items: rows.map((r) => ({ ...r, age: ageFrom(r.birth_date), specialty_labels: r.specialties.map((s) => CATEGORY_LABELS[s] || s) })) });
}));

app.post('/api/admin/applications/:id', auth.requireAdmin, wrap(async (req, res) => {
  const status = req.body.status;
  if (!['pending', 'approved', 'rejected'].includes(status)) throw bad('Неверный статус');
  const r = await db.query('UPDATE confectioners SET status=$2, admin_note=$3, updated_at=now() WHERE user_id=$1 RETURNING user_id',
    [Number(req.params.id), status, str(req.body.note, 500) || null]);
  if (!r.rows[0]) throw new HttpError(404, 'Анкета не найдена');
  res.json({ ok: true });
}));

app.get('/api/admin/files/:id', auth.requireAdmin, wrap(async (req, res) => {
  const { rows } = await db.query('SELECT name, mime, data FROM files WHERE id=$1', [Number(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, 'Файл не найден');
  res.setHeader('Content-Type', rows[0].mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(rows[0].name)}`);
  res.send(rows[0].data);
}));

app.get('/api/admin/settings', auth.requireAdmin, wrap(async (_req, res) => {
  res.json(await db.getSettings());
}));

app.put('/api/admin/settings', auth.requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const card = String(b.payment_card || '').replace(/\D/g, '');
  if (card && card.length !== 16) throw bad('Номер карты должен содержать 16 цифр');
  const holder = str(b.payment_card_holder, 80);
  if (card && holder.length < 3) throw bad('Укажите имя владельца карты, как на карте');
  const pct = Number(String(b.commission_percent ?? '').replace(',', '.'));
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) throw bad('Комиссия — число от 0 до 50 (%)');
  await db.setSetting('payment_card', card);
  await db.setSetting('payment_card_holder', holder);
  await db.setSetting('commission_percent', String(Math.round(pct * 100) / 100));
  res.json({ ok: true });
}));

app.get('/api/admin/clients', auth.requireAdmin, wrap(async (req, res) => {
  const q = str(req.query.q, 60);
  const params = [];
  let where = "u.role='client'";
  if (q) { params.push(`%${q}%`); where += ` AND (u.phone ILIKE $1 OR u.name ILIKE $1)`; }
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.phone, u.created_at,
            count(o.id)::int AS orders,
            count(o.id) FILTER (WHERE o.status IN ('paid','done'))::int AS paid_orders,
            COALESCE(sum(o.price) FILTER (WHERE o.status IN ('paid','done')), 0)::bigint AS paid_sum,
            max(o.created_at) AS last_order_at
     FROM users u LEFT JOIN orders o ON o.client_id=u.id
     WHERE ${where} GROUP BY u.id ORDER BY u.created_at DESC LIMIT 300`, params);
  res.json({ items: rows });
}));

app.get('/api/admin/orders', auth.requireAdmin, wrap(async (req, res) => {
  const filters = {
    review: "o.payment_status='review'",
    active: "o.status IN ('accepted','paid')",
    payout: "o.payout_status IN ('due','hold')",
    dispute: "o.dispute_status='open'",
    all: 'TRUE',
  };
  const where = filters[req.query.filter] || filters.review;
  const { rows } = await db.query(
    `SELECT o.*, c.full_name AS confectioner_name, c.payout_card, c.payout_holder, cu.phone AS confectioner_phone,
            c.address AS confectioner_address, c.lat AS confectioner_lat, c.lon AS confectioner_lon,
            COALESCE(u.name, 'Заказчик') AS client_name, u.phone AS client_phone
     FROM orders o
     JOIN confectioners c ON c.user_id=o.confectioner_id
     JOIN users cu ON cu.id=o.confectioner_id
     JOIN users u ON u.id=o.client_id
     WHERE ${where} ORDER BY o.updated_at DESC LIMIT 300`
  );
  res.json({ items: rows.map((o) => ({ ...o, payout_amount: orders.payoutAmount(o) })) });
}));

app.post('/api/admin/orders/:id/action', auth.requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const note = str(req.body.note, 500) || null;
  let ok = false;
  switch (req.body.action) {
    case 'confirm_payment': ok = await orders.markPaid(id, 'card'); break;
    case 'reject_payment': ok = await orders.rejectPayment(id, note); break;
    case 'refund': ok = await orders.refund(id, note || 'Средства возвращены заказчику'); break;
    case 'payout_done': {
      const r = await db.query("UPDATE orders SET payout_status='paid', payout_at=now(), updated_at=now() WHERE id=$1 AND status='done' AND payout_status='due' AND dispute_status IS DISTINCT FROM 'open' RETURNING id", [id]);
      ok = r.rowCount > 0; break;
    }
    case 'close_dispute': {
      const r = await db.query(
        `UPDATE orders SET dispute_status='rejected', admin_note=COALESCE($2, admin_note),
           payout_status=CASE WHEN status='done' AND payout_status='hold' THEN 'due' ELSE payout_status END, updated_at=now()
         WHERE id=$1 AND dispute_status='open' RETURNING id`, [id, note]);
      ok = r.rowCount > 0; break;
    }
    default: throw bad('Неизвестное действие');
  }
  if (!ok) throw bad('Действие недоступно для текущего статуса заказа');
  res.json({ ok: true });
}));

app.get('/api/admin/telegram', auth.requireAdmin, wrap(async (_req, res) => {
  if (!tg.enabled()) return res.json({ enabled: false });
  const [me, hook] = await Promise.all([tg.botInfo(), tg.webhookInfo()]);
  res.json({ enabled: true, bot: me && me.result, webhook: hook && hook.result });
}));

app.post('/api/admin/telegram/connect', auth.requireAdmin, wrap(async (req, res) => {
  if (!tg.enabled()) throw bad('TELEGRAM_BOT_TOKEN не задан в переменных окружения');
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  if (!base.startsWith('https://')) throw bad('Вебхук Telegram работает только по HTTPS (после деплоя на Vercel)');
  const r = await tg.setWebhook(`${base.replace(/\/$/, '')}/api/telegram/webhook`);
  if (!r || !r.ok) throw bad(`Telegram: ${r ? r.description : 'нет ответа'}`);
  res.json({ ok: true });
}));

/* ----------------------------- errors ----------------------------- */

app.use('/api', (_req, res) => res.status(404).json({ error: 'Не найдено' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 4 МБ' : 'Ошибка загрузки файла' });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Ошибка сервера. Попробуйте ещё раз.' : err.message });
});

app.locals.publicDir = path.join(__dirname, '..', 'public');

module.exports = app;
