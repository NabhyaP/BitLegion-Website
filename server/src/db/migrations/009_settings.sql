-- up
-- §D migration 005 (spec numbering) — Settings table.
-- Created here as 009 because job_runs already exists (migration 002).

CREATE TABLE settings (
  skey VARCHAR(60) PRIMARY KEY,   -- 'leaderboard_enabled', 'announcement', 'leaderboard_refresh_minutes'
  svalue TEXT NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default settings on first apply.
INSERT INTO settings (skey, svalue) VALUES
  ('leaderboard_enabled', 'true'),
  ('announcement', ''),
  ('leaderboard_refresh_minutes', '60');

-- down
DROP TABLE settings;
