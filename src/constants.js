'use strict';

/** Направления кондитеров. Ключ хранится в БД, подпись показывается на сайте. */
const CATEGORIES = [
  ['cakes', 'Торты'],
  ['bento', 'Бенто‑торты'],
  ['pastries', 'Пирожные'],
  ['cupcakes', 'Капкейки и маффины'],
  ['cookies', 'Печенье'],
  ['macarons', 'Макарон'],
  ['cheesecakes', 'Чизкейки'],
  ['bakery', 'Выпечка и пироги'],
  ['bread', 'Хлеб'],
  ['chocolate', 'Шоколад и конфеты'],
  ['dairy', 'Молочные продукты и десерты'],
  ['icecream', 'Мороженое'],
  ['national', 'Национальные сладости'],
  ['japanese', 'Японские сладости (моти, вагаси)'],
  ['seafood', 'Морепродукты'],
  ['healthy', 'Без сахара / без глютена / веган'],
  ['kids', 'Детские праздники'],
  ['wedding', 'Свадебные торты'],
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES);

module.exports = { CATEGORIES, CATEGORY_LABELS };
