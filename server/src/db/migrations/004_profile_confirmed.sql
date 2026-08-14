-- up
-- §B4 /onboarding requires the student to confirm parsed rollNo/batch/branch "editable once".
-- §D has no column for that one-time flag, so it is added here. See DECISIONS.md 2026-08-14.
ALTER TABLE users ADD COLUMN profile_confirmed TINYINT(1) NOT NULL DEFAULT 0;

-- down
ALTER TABLE users DROP COLUMN profile_confirmed;
