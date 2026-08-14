-- up
-- §D migration 006 (spec numbering) — Club org-chart tables.
-- Created here as 010 because 001–009 are already applied.

CREATE TABLE club_teams (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  display_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE club_team_members (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  team_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  name VARCHAR(100) NOT NULL,
  role_title VARCHAR(100) NOT NULL,
  cf_handle VARCHAR(64) NULL,
  photo_url VARCHAR(500) NULL,
  display_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (team_id) REFERENCES club_teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- down
DROP TABLE club_team_members;
DROP TABLE club_teams;
