CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at  INTEGER
);
CREATE INDEX sessions_user_created ON sessions(user_id, created_at);
CREATE INDEX sessions_expires_at   ON sessions(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE urls (
  code          TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  original_url  TEXT NOT NULL,
  url_hash      TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, url_hash)
);
