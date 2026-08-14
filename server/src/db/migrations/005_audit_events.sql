-- up
-- Spec migration 007. Pulled forward: §H Phase 1 requires the audit module from Phase 1 onward.
CREATE TABLE audit_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(40) NULL,
  target_id VARCHAR(60) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  request_id VARCHAR(60) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_actor_time (actor_user_id, created_at DESC),
  INDEX idx_audit_time (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- down
DROP TABLE audit_events;
