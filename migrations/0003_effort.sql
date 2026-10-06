-- 0003_effort.sql: "effort" leaderboard. Per (period, player) totals of verified runs, ranked by correct answers.
-- period = 'all' | 'dYYYY-MM-DD' | 'wYYYY-MM-DD' (same keys as scores).
CREATE TABLE effort (
  period      TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  correct     INTEGER NOT NULL,
  asked       INTEGER NOT NULL,
  runs        INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,                        -- last increment; tie-break: first to reach the count ranks higher
  PRIMARY KEY (period, player_id)
);
CREATE INDEX effort_rank ON effort(period, correct DESC, updated_at ASC);
