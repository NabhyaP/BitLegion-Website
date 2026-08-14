-- up
-- §D migration 002 (spec numbering) — Codeforces linking tables.
-- Created here as 006 because 001–005 are already applied.

CREATE TABLE codeforces_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  handle VARCHAR(64) NOT NULL,
  normalized_handle VARCHAR(64) NOT NULL UNIQUE,
  verified_at TIMESTAMP NOT NULL,
  status ENUM('ACTIVE','NOT_FOUND','RENAMED_OR_MISMATCHED','TEMPORARY_ERROR','UNLINKED')
    NOT NULL DEFAULT 'ACTIVE',
  last_checked_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE codeforces_link_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  state VARCHAR(128) NOT NULL UNIQUE,
  nonce VARCHAR(128) NOT NULL,
  pkce_verifier VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seeded on link (all zeros), picked up by Job 2 (Phase 3).
CREATE TABLE codeforces_solved_state (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  last_submission_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  solved_count INT NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMP NULL,
  last_error VARCHAR(500) NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- down
DROP TABLE codeforces_solved_state;
DROP TABLE codeforces_link_attempts;
DROP TABLE codeforces_accounts;
