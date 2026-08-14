-- up
-- §D migration 004 (spec numbering) — Solved-problems dedup table.
-- Created here as 008 because codeforces_solved_state already exists in migration 006.
-- problem_key format is "contestId-index" or "ps:{setName}:{name}" (see §E3).

CREATE TABLE codeforces_solved_problems (
  user_id BIGINT UNSIGNED NOT NULL,
  problem_key VARCHAR(80) NOT NULL,
  PRIMARY KEY (user_id, problem_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- down
DROP TABLE codeforces_solved_problems;
