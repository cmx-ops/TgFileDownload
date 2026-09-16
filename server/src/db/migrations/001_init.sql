-- 001_init.sql
-- Initial schema: config and tasks tables

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  file_name   TEXT NOT NULL,
  file_size   INTEGER,
  mime_type   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  progress    INTEGER NOT NULL DEFAULT 0,
  target_path TEXT,
  error       TEXT,
  message_info TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);