CREATE TABLE focus_sessions (
 id TEXT PRIMARY KEY,
 topic_id TEXT NOT NULL REFERENCES topics(id),
 owner_token TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','completed','interrupted')),
 started_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 ended_at TEXT,
 elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK(elapsed_ms >= 0),
 sequence INTEGER NOT NULL DEFAULT 0 CHECK(sequence >= 0),
 excluded_gaps INTEGER NOT NULL DEFAULT 0 CHECK(excluded_gaps >= 0)
);
CREATE UNIQUE INDEX focus_one_active ON focus_sessions(status) WHERE status='active';
CREATE TABLE focus_daily (
 session_id TEXT NOT NULL REFERENCES focus_sessions(id),
 day TEXT NOT NULL,
 elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms >= 0),
 PRIMARY KEY(session_id, day)
);
