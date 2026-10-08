-- 0007_deals_titles.sql: daily direct-buy deals and title reward claims (phase D2). Additive only.
-- one row per bought deal, keyed by the client ref (a replayed ref returns it). tx = the attempt that wrote it (in-batch guard, as shop_pulls)
CREATE TABLE shop_deals (
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ref        TEXT NOT NULL,
  tx         TEXT NOT NULL,
  day        TEXT NOT NULL,                            -- Bangkok day 'YYYY-MM-DD' of the offer
  slot       INTEGER NOT NULL,                         -- 0..DEAL_SLOTS.length-1
  item_id    TEXT NOT NULL,
  price      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, ref)
);
CREATE UNIQUE INDEX shop_deals_slot ON shop_deals(player_id, day, slot);
-- last applied POST /titles/claim (rate limit)
ALTER TABLE players ADD COLUMN title_claim_at INTEGER;
