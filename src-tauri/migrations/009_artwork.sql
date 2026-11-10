-- User-selected artwork is a private, self-contained part of the local backup.
-- No source path or remote URL is retained.
CREATE TABLE local_artwork (
  kind TEXT NOT NULL CHECK(kind IN ('book','course')),
  item_id TEXT NOT NULL,
  bytes BLOB NOT NULL CHECK(length(bytes)>0 AND length(bytes)<=10485760),
  width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1600),
  height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1600),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(kind,item_id)
);
