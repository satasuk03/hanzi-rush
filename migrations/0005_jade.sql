-- 0005_jade.sql: Jade wallet (docs/cosmetics-shop.md §11.2). Independent of 0004.
-- players.jade is a cached balance; jade_ledger is the truth. The CHECK makes a negative balance impossible even if
-- application code is wrong.
ALTER TABLE players ADD COLUMN jade INTEGER NOT NULL DEFAULT 0 CHECK (jade >= 0);

CREATE TABLE jade_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL,                         -- 'starter' | 'daily' | 'pull' | 'dupe_refund' | 'iap' | 'ad' | 'admin'
  ref           TEXT NOT NULL,                         -- idempotency key: 'starter', the Bangkok day for 'daily', a client uuid for 'pull'
  created_at    INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  UNIQUE (player_id, reason, ref)
);

CREATE TABLE inventory (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id   TEXT NOT NULL,
  copies    INTEGER NOT NULL DEFAULT 1,
  first_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, item_id)
);

CREATE TABLE banner_pity (
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  banner_id   TEXT NOT NULL,
  pulls_since INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, banner_id)
);

-- server-side daily streak, Asia/Bangkok day
CREATE TABLE jade_daily (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  last_day  TEXT NOT NULL,                             -- 'YYYY-MM-DD'
  streak    INTEGER NOT NULL
);
