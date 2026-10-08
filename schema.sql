CREATE TABLE IF NOT EXISTS waitlist (
  email       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  storage     TEXT,            -- "own" (bring your own drive) | "hosted" | "unsure"
  source      TEXT,            -- utm_source or referrer host
  created_at  TEXT NOT NULL,
  ip_hash     TEXT
);
CREATE INDEX IF NOT EXISTS waitlist_created ON waitlist (created_at);
