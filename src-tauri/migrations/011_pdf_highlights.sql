-- Migration 10 shipped with page notes before highlight anchors were added.
-- Rebuild its table so those installations also allow quote-only highlights.
ALTER TABLE pdf_annotations RENAME TO pdf_annotations_before_highlights;
CREATE TABLE pdf_annotations (
 id TEXT PRIMARY KEY,
 book_id TEXT NOT NULL REFERENCES books(id),
 document_revision TEXT NOT NULL CHECK(length(document_revision)=32),
 page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 100000),
 body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) BETWEEN 0 AND 20000),
 quote TEXT CHECK(quote IS NULL OR length(CAST(quote AS BLOB)) BETWEEN 1 AND 10000),
 rects_json TEXT NOT NULL DEFAULT '[]' CHECK(length(CAST(rects_json AS BLOB))<=50000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 deleted_at TEXT
);
-- Rust copies either historical notes or notes with existing highlight anchors,
-- then drops the old table and recreates its index in the same transaction.
