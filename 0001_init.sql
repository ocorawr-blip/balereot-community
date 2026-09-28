CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS whitelist (
  username TEXT PRIMARY KEY,
  roblox_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  asset_id TEXT,
  operation_id TEXT,
  asset_type TEXT,
  display_name TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
