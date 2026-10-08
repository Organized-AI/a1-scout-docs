CREATE TABLE IF NOT EXISTS waitlist (
  email       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  storage     TEXT,            -- "own" (bring your own drive) | "hosted" | "unsure"
  source      TEXT,            -- utm_source or referrer host
  created_at  TEXT NOT NULL,
  ip_hash     TEXT
);
CREATE INDEX IF NOT EXISTS waitlist_created ON waitlist (created_at);

-- Connect: computers paired to a workspace, and the session summaries they send.
CREATE TABLE IF NOT EXISTS workspaces (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  email         TEXT,
  browser_hash  TEXT NOT NULL,     -- sha256 of the approving browser's secret cookie; links more computers from the same browser
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workspaces_browser ON workspaces (browser_hash);
CREATE TABLE IF NOT EXISTS pairings (
  code          TEXT PRIMARY KEY,  -- shown to the person, e.g. QK7P-M2XD
  poll_hash     TEXT NOT NULL,     -- sha256 of the computer's poll token
  client        TEXT,
  status        TEXT NOT NULL,     -- pending | approved | collected
  workspace_id  TEXT,
  ip_hash       TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_keys (
  key_hash      TEXT PRIMARY KEY,  -- sha256 of the key the computer holds
  workspace_id  TEXT NOT NULL,
  client        TEXT,
  created_at    TEXT NOT NULL,
  last_used     TEXT
);
CREATE TABLE IF NOT EXISTS evidence (
  workspace_id    TEXT NOT NULL,
  source          TEXT NOT NULL,
  digest          TEXT NOT NULL,
  environment_id  TEXT NOT NULL,
  project_fp      TEXT NOT NULL,
  first_event     TEXT NOT NULL,
  last_event      TEXT NOT NULL,
  quality         TEXT NOT NULL,
  event_count     INTEGER NOT NULL,
  observations    TEXT NOT NULL,
  received_at     TEXT NOT NULL,
  PRIMARY KEY (workspace_id, source, digest)
);
CREATE INDEX IF NOT EXISTS evidence_ws_time ON evidence (workspace_id, last_event);
