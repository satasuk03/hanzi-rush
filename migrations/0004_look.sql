-- 0004_look.sql: cosmetics foundations (docs/cosmetics-shop.md §4.1, §12.2). Also carries the player-card columns so
-- phase C2 needs no second migration.
ALTER TABLE players ADD COLUMN look TEXT NOT NULL DEFAULT '{}';  -- sanitizeLook() JSON, e.g. {"avatar":"avatar_tiger"}
ALTER TABLE players ADD COLUMN profile_at INTEGER;               -- epoch ms of the last accepted PATCH /me/profile (rate limit)
ALTER TABLE players ADD COLUMN pub TEXT;                         -- public id: 8 chars of RECOVERY_ALPHABET, shown on boards as `pid`. Never expose players.id
ALTER TABLE players ADD COLUMN card TEXT;                        -- player-card snapshot JSON, rebuilt on PUT /save (phase C2)
ALTER TABLE players ADD COLUMN card_public INTEGER NOT NULL DEFAULT 1;

-- backfill: 8 random characters of the 32-char alphabet in server/auth.ts (random() is re-evaluated for every call)
UPDATE players SET pub =
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + (random() & 31), 1) ||
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + (random() & 31), 1) ||
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + (random() & 31), 1) ||
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + (random() & 31), 1) ||
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + (random() & 31), 1) ||
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + (random() & 31), 1) ||
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + (random() & 31), 1) ||
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + (random() & 31), 1);
CREATE UNIQUE INDEX players_pub ON players(pub) WHERE pub IS NOT NULL;
