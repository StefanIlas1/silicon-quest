-- Notes belong to an exact imported PDF revision; replacement never reanchors them.
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
CREATE INDEX pdf_annotations_document ON pdf_annotations(book_id,document_revision,page);
