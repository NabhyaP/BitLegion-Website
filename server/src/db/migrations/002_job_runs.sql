-- up
-- Pulled forward from spec migration 005 so the Phase 0 cron spike has a target table.
CREATE TABLE job_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_code VARCHAR(60) NOT NULL,
  status ENUM('RUNNING','OK','FAILED') NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  duration_ms INT NULL,
  detail JSON NULL,
  INDEX idx_job_runs (job_code, started_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- down
DROP TABLE job_runs;
