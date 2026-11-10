CREATE TABLE credential_definitions (
 id TEXT PRIMARY KEY,title TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('course_certificate','specialization_certificate','formal_certification','optional_coursework')),
 optional INTEGER NOT NULL CHECK(optional IN (0,1)),metadata_json TEXT NOT NULL
);
CREATE TABLE credential_progress (
 credential_id TEXT PRIMARY KEY REFERENCES credential_definitions(id),
 status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','in_progress','on_hold','completed','not_pursuing')),
 target_date TEXT,evidence_note TEXT NOT NULL DEFAULT '',evidence_reference TEXT NOT NULL DEFAULT '',
 completed_at TEXT,updated_at TEXT,version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 CHECK((status='completed' AND completed_at IS NOT NULL) OR (status<>'completed' AND completed_at IS NULL))
);
CREATE TABLE credential_actions (
 request_id TEXT PRIMARY KEY,credential_id TEXT NOT NULL REFERENCES credential_definitions(id),
 action TEXT NOT NULL CHECK(action IN ('saved','catalog_updated')),payload_json TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,definition_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX credential_action_time ON credential_actions(created_at);
