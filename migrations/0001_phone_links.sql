CREATE TABLE IF NOT EXISTS links (
  code TEXT PRIMARY KEY,
  poll_hash TEXT NOT NULL UNIQUE,
  workspace_id TEXT REFERENCES workspaces(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'collected')),
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS links_ip_time ON links (ip_hash, created_at);
