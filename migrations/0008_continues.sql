-- 0008_continues.sql: buy back a heart in rush (shared/api.ts CONTINUE, server/continues.ts). Additive only.
-- runs.continues counts the continues paid on a ticket; POST /runs accepts a submitted count up to it.
ALTER TABLE runs ADD COLUMN continues INTEGER NOT NULL DEFAULT 0;

-- One row per rewarded ad AdMob confirmed through server-side verification (GET /ads/admob-ssv).
-- custom_data is the run ticket the client passed to the ad. A continue claims one unclaimed row for its ticket.
CREATE TABLE ad_rewards (
  transaction_id TEXT PRIMARY KEY,                    -- AdMob's, so a repeated callback inserts nothing
  custom_data    TEXT NOT NULL,
  ad_unit        TEXT NOT NULL,
  verified_at    INTEGER NOT NULL,
  player_id      TEXT REFERENCES players(id) ON DELETE CASCADE, -- set when a continue claims the reward
  claimed_at     INTEGER
);
CREATE INDEX ad_rewards_custom ON ad_rewards (custom_data);
CREATE INDEX ad_rewards_player ON ad_rewards (player_id, claimed_at);
