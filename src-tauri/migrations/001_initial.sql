CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE topics (id TEXT PRIMARY KEY, book_id TEXT REFERENCES books(id), title TEXT NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE topic_progress (
 topic_id TEXT PRIMARY KEY REFERENCES topics(id),
 status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','reading','read')),
 mastery TEXT NOT NULL DEFAULT 'untested' CHECK(mastery IN ('untested','needs_review','passed')),
 best_score INTEGER CHECK(best_score BETWEEN 0 AND 100), last_studied_at TEXT
);
CREATE TABLE notes (topic_id TEXT PRIMARY KEY REFERENCES topics(id), body TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE quiz_attempts (
 attempt_id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topics(id),
 answers_json TEXT NOT NULL, score INTEGER NOT NULL, total INTEGER NOT NULL CHECK(total > 0),
 passed INTEGER NOT NULL CHECK(passed IN (0,1)), xp_awarded INTEGER NOT NULL DEFAULT 0,
 feedback_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE xp_ledger (event_key TEXT PRIMARY KEY, amount INTEGER NOT NULL CHECK(amount > 0), created_at TEXT NOT NULL);
CREATE TABLE achievements (id TEXT PRIMARY KEY, title TEXT NOT NULL, earned_at TEXT NOT NULL);
CREATE TABLE activity_days (day TEXT PRIMARY KEY);
CREATE TABLE book_documents (book_id TEXT PRIMARY KEY REFERENCES books(id), file_name TEXT NOT NULL, imported_at TEXT NOT NULL, bytes BLOB NOT NULL);
