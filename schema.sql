CREATE TABLE IF NOT EXISTS users (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  leave   REAL DEFAULT 0,
  active  INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sites (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  active  INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS records (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  date            TEXT NOT NULL,
  user_name       TEXT NOT NULL,
  attendance      TEXT NOT NULL,
  site_mode       TEXT DEFAULT '',
  site            TEXT DEFAULT '',
  work_days       REAL DEFAULT 0,
  overtime        TEXT DEFAULT '',
  overtime_start  TEXT DEFAULT '',
  overtime_end    TEXT DEFAULT '',
  stay            TEXT DEFAULT '',
  meal            TEXT DEFAULT '',
  car_type        TEXT DEFAULT '',
  commute_genba   TEXT DEFAULT '',
  commute_shugo   TEXT DEFAULT '',
  driver          TEXT DEFAULT '',
  passengers      TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS admins (
  login_id  TEXT PRIMARY KEY,
  password  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

-- デフォルト管理者: admin / asahi0000
INSERT OR IGNORE INTO admins (login_id, password) VALUES ('admin', 'asahi0000');
