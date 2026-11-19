'use strict';
// Общая логика оплаты заказов: используется сайтом, админкой, Telegram‑ботом и Payme.
const db = require('./db');

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ');

function payoutAmount(o) {
  if (!o.price) return 0;
  const pct = Number(o.commission_percent ?? 0);
  return Math.max(0, Math.round(Number(o.price) * (1 - pct / 100)));
}

async function load(id) {
  const { rows } = await db.query(
    `SELECT o.*, c.full_name AS confectioner_name, c.payout_card, c.payout_holder, cu.phone AS confectioner_phone,
            COALESCE(u.name, 'Заказчик') AS client_name, u.phone AS client_phone
     FROM orders o
     JOIN confectioners c ON c.user_id=o.confectioner_id
     JOIN users cu ON cu.id=o.confectioner_id
     JOIN users u ON u.id=o.client_id
     WHERE o.id=$1`,
    [id]
  );
  return rows[0] || null;
}

/** Отметить заказ оплаченным. Возвращает true, если статус реально изменился. */
async function markPaid(id, method) {
  const r = await db.query(
    `UPDATE orders SET status='paid', payment_status='paid', payment_method=$2, paid_at=now(), updated_at=now()
     WHERE id=$1 AND status='accepted' AND payment_status IN ('unpaid','review') RETURNING id`,
    [id, method]
  );
  return r.rowCount > 0;
}

async function rejectPayment(id, note) {
  const r = await db.query(
    `UPDATE orders SET payment_status='unpaid', admin_note=$2, updated_at=now()
     WHERE id=$1 AND status='accepted' AND payment_status='review' RETURNING id`,
    [id, note || 'Оплата не найдена. Проверьте перевод или свяжитесь с поддержкой.']
  );
  return r.rowCount > 0;
}

/** Возврат средств заказчику (до выплаты кондитеру). */
async function refund(id, note) {
  const r = await db.query(
    `UPDATE orders SET status='refunded', payment_status='refunded', payout_status='none',
       dispute_status=CASE WHEN dispute_status='open' THEN 'refunded' ELSE dispute_status END,
       admin_note=COALESCE($2, admin_note), updated_at=now()
     WHERE id=$1 AND payment_status='paid' AND payout_status<>'paid' RETURNING id`,
    [id, note || null]
  );
  return r.rowCount > 0;
}

module.exports = { load, markPaid, rejectPayment, refund, payoutAmount, fmt };
