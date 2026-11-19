'use strict';
// Локальный запуск: node server.js  (на Vercel используется api/index.js)
require('dotenv').config();
const express = require('express');
const app = require('./src/app');

const root = express();
root.use(app);
root.use(express.static(app.locals.publicDir, { extensions: ['html'] }));
root.use((req, res) => res.status(404).sendFile('404.html', { root: app.locals.publicDir }));

const port = Number(process.env.PORT || 3000);
root.listen(port, () => console.log(`Shokutaku 食卓 запущен: http://localhost:${port}`));
