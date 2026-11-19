'use strict';
const db = require('./db');
const auth = require('./auth');
const { CATEGORY_LABELS } = require('./constants');

const API = 'https://api.telegram.org';

function token() { return process.env.TELEGRAM_BOT_TOKEN; }
function enabled() { return !!token(); }

async function call(method, payload) {
  if (!enabled()) return null;
  const res = await fetch(`${API}/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) console.error('Telegram', method, json.description || res.status);
  return json;
}

async function sendDocument(chatId, file, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption.slice(0, 1000));
  form.append('document', new Blob([file.data], { type: file.mime }), file.name);
  const res = await fetch(`${API}/bot${token()}/sendDocument`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) console.error('Telegram sendDocument', json.description || res.status);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function adminChats() {
  const { rows } = await db.query('SELECT chat_id FROM admin_chats');
  return rows.map((r) => r.chat_id);
}

function ageFrom(birth) {
  const b = new Date(birth);
  const n = new Date();
  let age = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) age--;
  return age;
}

const STATUS = { pending: '⏳ на проверке', approved: '✅ принят', rejected: '❌ отклонён' };

function applicationText(c) {
  const age = ageFrom(c.birth_date);
  const lines = [
    `<b>🧁 Анкета кондитера #${c.user_id}</b>  ${STATUS[c.status] || ''}`,
    '',
    `<b>Имя:</b> ${esc(c.full_name)}`,
    `<b>Телефон:</b> ${esc(c.phone)}`,
    `<b>Возраст:</b> ${age} (д.р. ${new Date(c.birth_date).toLocaleDateString('ru-RU')})`,
  ];
  if (age < 18) {
    lines.push(`<b>Родитель:</b> ${esc(c.parent_name)}, ${esc(c.parent_phone)}`);
  }
  lines.push(
    `<b>Город:</b> ${esc(c.city || '—')}`,
    `<b>Стаж:</b> ${c.experience_years} лет`,
    `<b>Где работал(а)/работает:</b> ${esc(c.workplace || '—')}`,
    `<b>Направления:</b> ${esc((c.specialties || []).map((s) => CATEGORY_LABELS[s] || s).join(', ') || '—')}`,
    `<b>Лучше всего готовит:</b> ${esc(c.signature_dishes || '—')}`,
    `<b>О себе:</b> ${esc(c.about || '—')}`,
    `<b>Сертификат:</b> ${c.certificate_file ? 'есть (файл ниже)' : 'нет'}`,
    `<b>Условия приняты:</b> ${new Date(c.terms_accepted_at).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })}`
  );
  if (c.admin_note) lines.push(`<b>Заметка:</b> ${esc(c.admin_note)}`);
  return lines.join('\n');
}

function decisionKeyboard(id) {
  return {
    inline_keyboard: [[
      { text: '✅ Принять', callback_data: `approve:${id}` },
      { text: '❌ Отклонить', callback_data: `reject:${id}` },
    ]],
  };
}

async function loadApplication(userId) {
  const { rows } = await db.query(
    `SELECT c.*, u.phone FROM confectioners c JOIN users u ON u.id=c.user_id WHERE c.user_id=$1`,
    [userId]
  );
  return rows[0];
}

/** Отправить анкету нового кондитера всем авторизованным админ‑чатам. */
async function notifyNewApplication(userId) {
  if (!enabled()) return;
  const chats = await adminChats();
  if (!chats.length) return;
  const c = await loadApplication(userId);
  if (!c) return;
  let file = null;
  if (c.certificate_file) {
    const r = await db.query('SELECT name, mime, data FROM files WHERE id=$1', [c.certificate_file]);
    file = r.rows[0];
  }
  for (const chat of chats) {
    await call('sendMessage', {
      chat_id: chat, text: applicationText(c), parse_mode: 'HTML', reply_markup: decisionKeyboard(c.user_id),
    });
    if (file) await sendDocument(chat, file, `Сертификат: ${c.full_name}`);
  }
}

async function notifyAdmins(text) {
  if (!enabled()) return;
  for (const chat of await adminChats()) {
    await call('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true });
  }
}

async function setStatus(userId, status) {
  await db.query('UPDATE confectioners SET status=$2, updated_at=now() WHERE user_id=$1', [userId, status]);
}

const HELP = [
  '<b>Shokutaku 食卓 — админ‑бот</b>',
  '',
  '/pending — анкеты, ожидающие проверки',
  '/stats — статистика сайта',
  '/logout — выйти из бота',
].join('\n');

/** Обработка входящего апдейта от Telegram (вебхук). */
async function handleUpdate(update) {
  if (update.callback_query) return handleCallback(update.callback_query);
  const msg = update.message;
  if (!msg || !msg.text || msg.chat.type !== 'private') return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const [cmd, ...args] = text.split(/\s+/);
  const isAdmin = (await adminChats()).map(String).includes(String(chatId));

  if (cmd === '/login') {
    // Сообщение с паролем сразу удаляем из истории чата.
    await call('deleteMessage', { chat_id: chatId, message_id: msg.message_id });
    const key = `tg:${chatId}`;
    if (await auth.tooManyAttempts(key, 5)) {
      return call('sendMessage', { chat_id: chatId, text: 'Слишком много попыток. Попробуйте через 15 минут.' });
    }
    if (args.length !== 2 || !(await auth.checkAdminCredentials(args[0], args[1]))) {
      await auth.recordFailure(key);
      return call('sendMessage', { chat_id: chatId, text: 'Неверный логин или пароль.\nФормат: /login логин пароль' });
    }
    await auth.clearFailures(key);
    await db.query(
      'INSERT INTO admin_chats(chat_id, username) VALUES ($1,$2) ON CONFLICT (chat_id) DO UPDATE SET username=EXCLUDED.username',
      [chatId, msg.from && msg.from.username]
    );
    return call('sendMessage', { chat_id: chatId, text: `✅ Вы вошли как администратор.\n\n${HELP}`, parse_mode: 'HTML' });
  }

  if (!isAdmin) {
    return call('sendMessage', {
      chat_id: chatId,
      text: '🔒 Это закрытый бот администратора Shokutaku 食卓.\nДля входа: /login логин пароль',
    });
  }

  if (cmd === '/logout') {
    await db.query('DELETE FROM admin_chats WHERE chat_id=$1', [chatId]);
    return call('sendMessage', { chat_id: chatId, text: 'Вы вышли. Уведомления больше не приходят.' });
  }

  if (cmd === '/pending') {
    const { rows } = await db.query("SELECT user_id FROM confectioners WHERE status='pending' ORDER BY created_at LIMIT 20");
    if (!rows.length) return call('sendMessage', { chat_id: chatId, text: 'Новых анкет нет 🎉' });
    for (const r of rows) {
      const c = await loadApplication(r.user_id);
      await call('sendMessage', { chat_id: chatId, text: applicationText(c), parse_mode: 'HTML', reply_markup: decisionKeyboard(c.user_id) });
      if (c.certificate_file) {
        const f = await db.query('SELECT name, mime, data FROM files WHERE id=$1', [c.certificate_file]);
        if (f.rows[0]) await sendDocument(chatId, f.rows[0], `Сертификат: ${c.full_name}`);
      }
    }
    return;
  }

  if (cmd === '/stats') {
    const { rows } = await db.query(`SELECT
      (SELECT count(*) FROM users WHERE role='client')::int AS clients,
      (SELECT count(*) FROM confectioners WHERE status='approved')::int AS approved,
      (SELECT count(*) FROM confectioners WHERE status='pending')::int AS pending,
      (SELECT count(*) FROM orders)::int AS orders`);
    const s = rows[0];
    return call('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: `<b>📊 Статистика</b>\nЗаказчиков: ${s.clients}\nКондитеров (приняты): ${s.approved}\nАнкет на проверке: ${s.pending}\nЗаявок на заказ: ${s.orders}`,
    });
  }

  return call('sendMessage', { chat_id: chatId, text: HELP, parse_mode: 'HTML' });
}

async function handleCallback(cb) {
  const chatId = cb.message && cb.message.chat.id;
  const isAdmin = (await adminChats()).map(String).includes(String(chatId));
  if (!isAdmin) return call('answerCallbackQuery', { callback_query_id: cb.id, text: 'Нет доступа' });
  const [action, idStr] = String(cb.data || '').split(':');
  const id = Number(idStr);
  if (!['approve', 'reject'].includes(action) || !id) {
    return call('answerCallbackQuery', { callback_query_id: cb.id });
  }
  await setStatus(id, action === 'approve' ? 'approved' : 'rejected');
  const c = await loadApplication(id);
  await call('answerCallbackQuery', { callback_query_id: cb.id, text: action === 'approve' ? 'Кондитер принят' : 'Анкета отклонена' });
  if (c) {
    await call('editMessageText', {
      chat_id: chatId, message_id: cb.message.message_id, text: applicationText(c), parse_mode: 'HTML',
      reply_markup: decisionKeyboard(c.user_id),
    });
  }
}

async function setWebhook(url) {
  return call('setWebhook', {
    url,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
}

async function webhookInfo() { return call('getWebhookInfo', {}); }
async function botInfo() { return call('getMe', {}); }

module.exports = {
  enabled, handleUpdate, notifyNewApplication, notifyAdmins, setWebhook, webhookInfo, botInfo, esc, ageFrom,
};
