// Использование: node scripts/hash-password.js "ваш-пароль"
// Выводит bcrypt‑хеш для переменной ADMIN_PASSWORD_HASH. Сам пароль нигде не сохраняется.
const bcrypt = require('bcryptjs');
const pwd = process.argv[2];
if (!pwd) { console.error('Укажите пароль: node scripts/hash-password.js "пароль"'); process.exit(1); }
console.log(bcrypt.hashSync(pwd, 12));
