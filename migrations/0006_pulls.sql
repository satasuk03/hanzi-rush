-- 0006_pulls.sql: box pulls (docs/cosmetics-shop.md §5.2, §11.2). Additive only.
-- pull_seq is the per-player pull version: every applied pull bumps it, and a pull only applies if it still matches the
-- value its roll was computed from (server/shop.ts explains the guard). pull_at is the last applied pull (rate limit).
ALTER TABLE players ADD COLUMN pull_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN pull_at INTEGER;

-- one row per applied pull, keyed by the client ref, so a replayed ref returns the original result
CREATE TABLE shop_pulls (
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ref        TEXT NOT NULL,                            -- client idempotency key (same as the 'pull' jade_ledger row)
  tx         TEXT NOT NULL,                            -- random id of the attempt that wrote it (in-batch guard)
  seq        INTEGER NOT NULL,                         -- players.pull_seq after this pull (1, 2, 3 ...)
  box        TEXT NOT NULL,
  qty        INTEGER NOT NULL,
  cost       INTEGER NOT NULL,
  refund     INTEGER NOT NULL,
  drops      TEXT NOT NULL,                            -- ShopDrop[] JSON, in roll order
  pity       TEXT NOT NULL,                            -- box id -> pulls_since after this pull, JSON
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, ref)
);
