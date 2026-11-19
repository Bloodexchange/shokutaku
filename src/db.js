'use strict';
const { Pool } = require('pg');

let pool;
let migrated = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) throw new Error('DATABASE_URL не задан');
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    pool = new Pool({
      connectionString,
      ssl: local ? false : { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX || 3),
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  phone         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('client','confectioner')),
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS confectioners (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name         TEXT NOT NULL,
  birth_date        DATE NOT NULL,
  parent_name       TEXT,
  parent_phone      TEXT,
  city              TEXT,
  experience_years  INTEGER NOT NULL DEFAULT 0,
  workplace         TEXT,
  specialties       TEXT[] NOT NULL DEFAULT '{}',
  signature_dishes  TEXT,
  about             TEXT,
  certificate_file  INTEGER REFERENCES files(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note        TEXT,
  terms_accepted_at TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS confectioners_status_idx ON confectioners(status);

CREATE TABLE IF NOT EXISTS orders (
  id               SERIAL PRIMARY KEY,
  client_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  confectioner_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dish             TEXT NOT NULL,
  components       TEXT,
  event_date       DATE,
  budget           TEXT,
  comment          TEXT,
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','declined','done','cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_client_idx ON orders(client_id);
CREATE INDEX IF NOT EXISTS orders_conf_idx ON orders(confectioner_id);

CREATE TABLE IF NOT EXISTS reviews (
  id              SERIAL PRIMARY KEY,
  order_id        INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  confectioner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_chats (
  chat_id    BIGINT PRIMARY KEY,
  username   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts(key, created_at);
`;

async function migrate() {
  if (!migrated) {
    migrated = getPool().query(SCHEMA).catch((e) => { migrated = null; throw e; });
  }
  return migrated;
}

async function query(text, params) {
  await migrate();
  return getPool().query(text, params);
}

module.exports = { query, migrate, getPool };
