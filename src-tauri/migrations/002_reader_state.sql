-- Existing documents receive independent opaque revisions without changing PDFs.
ALTER TABLE book_documents ADD COLUMN document_revision TEXT NOT NULL DEFAULT '';
UPDATE book_documents SET document_revision = lower(hex(randomblob(16)));

CREATE TABLE reader_positions (
 book_id TEXT NOT NULL REFERENCES books(id),
 document_revision TEXT NOT NULL,
 page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 100000),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(book_id, document_revision)
);
CREATE TABLE page_bookmarks (
 id TEXT PRIMARY KEY,
 book_id TEXT NOT NULL REFERENCES books(id),
 document_revision TEXT NOT NULL,
 page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 100000),
 label TEXT NOT NULL CHECK(length(label) <= 200),
 created_at TEXT NOT NULL,
 deleted_at TEXT,
 UNIQUE(book_id, document_revision, page)
);
CREATE INDEX page_bookmarks_document ON page_bookmarks(book_id, document_revision, page);
