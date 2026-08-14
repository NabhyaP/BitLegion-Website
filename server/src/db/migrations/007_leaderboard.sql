-- up
-- §D migration 003 (spec numbering) — Leaderboard tables.
-- Created here as 007 because 001–006 are already applied.

CREATE TABLE leaderboard_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  status ENUM('RUNNING','READY','FAILED','ABANDONED') NOT NULL DEFAULT 'RUNNING',
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  handles_requested INT NOT NULL DEFAULT 0,
  handles_updated INT NOT NULL DEFAULT 0,
  handles_stale INT NOT NULL DEFAULT 0,
  cf_calls INT NOT NULL DEFAULT 0,
  error_summary VARCHAR(1000) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE leaderboard_entries (
  version_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  position INT NOT NULL,
  handle VARCHAR(64) NOT NULL,
  rating INT NOT NULL DEFAULT 0,
  max_rating INT NOT NULL DEFAULT 0,
  cf_rank VARCHAR(40) NULL,
  cf_max_rank VARCHAR(40) NULL,
  solved_count INT NULL,
  contribution INT NULL,
  last_online_at TIMESTAMP NULL,
  avatar_url VARCHAR(500) NULL,
  profile_updated_at TIMESTAMP NOT NULL,
  stale TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (version_id, user_id),
  FOREIGN KEY (version_id) REFERENCES leaderboard_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_lb_rating (version_id, rating DESC, max_rating DESC),
  INDEX idx_lb_maxrating (version_id, max_rating DESC, rating DESC),
  INDEX idx_lb_solved (version_id, solved_count DESC),
  INDEX idx_lb_position (version_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pointer to the currently active (published) snapshot. Always has exactly 1 row (id=1).
CREATE TABLE leaderboard_active (
  id TINYINT UNSIGNED PRIMARY KEY,
  version_id BIGINT UNSIGNED NOT NULL,
  activated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (version_id) REFERENCES leaderboard_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Daily rating/solved snapshots for ratingChange30d calculation.
CREATE TABLE codeforces_rating_daily (
  user_id BIGINT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  rating INT NOT NULL,
  max_rating INT NOT NULL,
  solved_count INT NULL,
  PRIMARY KEY (user_id, snapshot_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- down
DROP TABLE codeforces_rating_daily;
DROP TABLE leaderboard_active;
DROP TABLE leaderboard_entries;
DROP TABLE leaderboard_versions;
