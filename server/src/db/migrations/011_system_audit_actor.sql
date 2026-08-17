-- up
-- Secret-triggered cron requests are system actions and have no user actor.
ALTER TABLE audit_events MODIFY actor_user_id BIGINT UNSIGNED NULL;

-- down
DELETE FROM audit_events WHERE actor_user_id IS NULL;
ALTER TABLE audit_events MODIFY actor_user_id BIGINT UNSIGNED NOT NULL;
