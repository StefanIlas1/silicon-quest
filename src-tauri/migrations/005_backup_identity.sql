PRAGMA application_id = 1397836881;
CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO app_metadata(key,value) VALUES('data_epoch',lower(hex(randomblob(16))));
CREATE TABLE backup_metadata (
 id INTEGER PRIMARY KEY CHECK(id=1),
 format_version INTEGER NOT NULL CHECK(format_version=1),
 created_at TEXT NOT NULL
);
