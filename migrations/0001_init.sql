-- 0001_init.sql: Hanzi Rush backend
-- players: one row per account (guest or linked)
CREATE TABLE players (
  id                  TEXT PRIMARY KEY,               -- uuid v4
  tag                 TEXT NOT NULL,                  -- 4 chars of RECOVERY_ALPHABET, public, not unique
  name                TEXT NOT NULL DEFAULT '',       -- sanitizeName()
  title               TEXT NOT NULL DEFAULT 'novice', -- sanitizeTitle()
  created_at          INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL,
  recovery_hash       TEXT,                           -- sha256 hex of normalized code
  recovery_created_at INTEGER,
  status              INTEGER NOT NULL DEFAULT 0,     -- 0 ok, 1 hidden from boards (shadow ban), 2 disabled (401)
  created_ip_hash     TEXT                            -- sha256(IP_SALT + ip), for abuse forensics only
);
CREATE UNIQUE INDEX players_recovery ON players(recovery_hash) WHERE recovery_hash IS NOT NULL;

-- sessions: device logins; token never stored in clear
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,                       -- sha256 hex of the bearer token
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  via          TEXT NOT NULL,                          -- 'guest' | 'recovery' | 'apple' | 'google' | 'email'
  platform     TEXT,                                   -- 'web' | 'ios' | 'android'
  app_version  TEXT
);
CREATE INDEX sessions_player ON sessions(player_id);

-- identities: future third-party sign-in links (unused until sign-in ships)
CREATE TABLE identities (
  provider   TEXT NOT NULL,                            -- 'apple' | 'google' | 'email'
  subject    TEXT NOT NULL,                            -- provider's stable user id / lowercased email
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  email      TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_player ON identities(player_id);

-- saves: one opaque SaveDoc JSON per player, compare-and-swap on revision
CREATE TABLE saves (
  player_id         TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  revision          INTEGER NOT NULL,
  format            INTEGER NOT NULL,                  -- SAVE_FORMAT
  data              TEXT NOT NULL,
  bytes             INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  client_updated_at INTEGER
);

-- runs: tickets + submissions (audit log, idempotency, rate limiting)
CREATE TABLE runs (
  id            TEXT PRIMARY KEY,                      -- ticket (random 128-bit, base64url) or uuid for ticketless
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  board         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,                      -- ticket issue time (verified) or submit time (ticketless)
  client_run_id TEXT,                                  -- set on submit
  submitted_at  INTEGER,
  score         INTEGER,
  correct       INTEGER,
  asked         INTEGER,
  max_combo     INTEGER,
  duration_ms   INTEGER,
  verified      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'open',          -- 'open' | 'ok' | 'rejected'
  reason        TEXT                                   -- checkRun() reason when rejected
);
CREATE INDEX runs_player_time ON runs(player_id, created_at);
CREATE UNIQUE INDEX runs_client ON runs(player_id, client_run_id) WHERE client_run_id IS NOT NULL;
CREATE INDEX runs_prune ON runs(created_at);

-- scores: best per (board, period, player). period = 'all' | 'dYYYY-MM-DD' | 'wYYYY-MM-DD'
CREATE TABLE scores (
  board       TEXT NOT NULL,
  period      TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,
  run_id      TEXT NOT NULL,
  verified    INTEGER NOT NULL,
  PRIMARY KEY (board, period, player_id)
);
CREATE INDEX scores_rank ON scores(board, period, score DESC, achieved_at ASC);
CREATE INDEX scores_period ON scores(period);

-- rate_limits: fixed-window counters for unauthenticated endpoints only
CREATE TABLE rate_limits (
  key    TEXT NOT NULL,                                -- 'create:<iphash>' | 'recover:<iphash>'
  bucket INTEGER NOT NULL,                             -- floor(now / 3600000)
  count  INTEGER NOT NULL,
  PRIMARY KEY (key, bucket)
);
