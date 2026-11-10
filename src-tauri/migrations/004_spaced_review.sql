CREATE TABLE review_schedule (
 topic_id TEXT PRIMARY KEY REFERENCES topics(id),
 stage TEXT NOT NULL CHECK(stage IN ('learning','needs_review','mastered')),
 successful_reviews INTEGER NOT NULL CHECK(successful_reviews >= 0),
 due_at TEXT NOT NULL,
 interval_days INTEGER NOT NULL CHECK(interval_days IN (1,3,7,14,30)),
 last_attempt_at TEXT NOT NULL,
 last_qualified_at TEXT,
 lapse_count INTEGER NOT NULL CHECK(lapse_count >= 0)
);
CREATE TABLE review_events (
 attempt_id TEXT PRIMARY KEY REFERENCES quiz_attempts(attempt_id),
 topic_id TEXT NOT NULL REFERENCES topics(id),
 passed INTEGER NOT NULL CHECK(passed IN (0,1)),
 qualified INTEGER NOT NULL CHECK(qualified IN (0,1)),
 reason TEXT NOT NULL CHECK(reason IN ('first_pass','scheduled_pass','early_practice','failed_check')),
 created_at TEXT NOT NULL,
 stage_after TEXT NOT NULL CHECK(stage_after IN ('learning','needs_review','mastered')),
 successful_reviews_after INTEGER NOT NULL CHECK(successful_reviews_after >= 0),
 due_at_after TEXT NOT NULL
);
CREATE INDEX review_due ON review_schedule(due_at,topic_id);
CREATE INDEX review_event_time ON review_events(created_at);
-- Historical reward stays earned; its name describes the original check honestly.
UPDATE achievements SET title='First Check Passed' WHERE id='first-mastery';
