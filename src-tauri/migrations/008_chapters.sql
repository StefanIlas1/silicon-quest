-- User-entered indexes. No chapter metadata is inferred from roadmap topics.
CREATE TABLE book_chapters (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 100),
 book_id TEXT NOT NULL REFERENCES books(id),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 10000),
 status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','reading','read')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(CAST(note AS BLOB)) <= 20000),
 page_start INTEGER CHECK(page_start BETWEEN 1 AND 100000),
 page_end INTEGER CHECK(page_end BETWEEN page_start AND 100000),
 document_revision TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK((page_start IS NULL AND page_end IS NULL AND document_revision IS NULL) OR
       (page_start IS NOT NULL AND page_end IS NOT NULL AND document_revision IS NOT NULL AND length(document_revision)>0))
);
CREATE INDEX book_chapters_order ON book_chapters(book_id,position,id);
