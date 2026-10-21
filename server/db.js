import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
export const EXPORT_DIR = path.join(DATA_DIR, 'exports');
fs.mkdirSync(EXPORT_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'pollen.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name           TEXT NOT NULL,
    pw_hash        TEXT NOT NULL,
    totp_secret    TEXT,
    totp_pending   TEXT,
    totp_enabled   INTEGER NOT NULL DEFAULT 0,
    totp_last_step INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recovery_codes (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stage      TEXT NOT NULL DEFAULT 'full',
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip         TEXT,
    ua         TEXT
  );

  CREATE TABLE IF NOT EXISTS exports (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    form       TEXT,
    mime       TEXT NOT NULL,
    file       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    width      INTEGER,
    height     INTEGER,
    duration   REAL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS exports_user ON exports(user_id, created_at DESC);
`);
