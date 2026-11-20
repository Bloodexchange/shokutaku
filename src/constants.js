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

/** Города храним по‑русски: узбекские и латинские названия приводим к одному виду. */
const CITIES = {
  'Ташкент': ['toshkent', 'tashkent', 'тошкент'],
  'Самарканд': ['samarqand', 'samarkand', 'самарқанд'],
  'Бухара': ['buxoro', 'bukhara', 'бухоро'],
  'Андижан': ['andijon', 'andijan', 'андижон'],
  'Наманган': ['namangan'],
  'Фергана': ['farg‘ona', "farg'ona", 'fargʻona', 'fargona', 'fergana', 'фарғона'],
  'Нукус': ['nukus'],
  'Карши': ['qarshi', 'karshi', 'қарши'],
  'Навои': ['navoiy', 'navoi', 'навоий'],
  'Джизак': ['jizzax', 'jizzakh', 'jizzak', 'жиззах'],
  'Ургенч': ['urganch', 'urgench', 'урганч'],
  'Термез': ['termiz', 'termez', 'термиз'],
  'Гулистан': ['guliston', 'gulistan', 'гулистон'],
};
const CITY_ALIASES = Object.fromEntries(Object.entries(CITIES).flatMap(([ru, list]) => [ru.toLowerCase(), ...list].map((a) => [a, ru])));
const normalizeCity = (city) => (city ? CITY_ALIASES[String(city).trim().toLowerCase()] || city : city);

module.exports = { CATEGORIES, CATEGORY_LABELS, normalizeCity };
