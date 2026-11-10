//! A private, manually entered index, independent of provisional roadmap topics.
use crate::{
    backup,
    store::{Result, Store},
};
use chrono::Utc;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub book_id: String,
    pub title: String,
    pub position: i64,
    pub status: String,
    pub note: String,
    pub page_start: Option<i64>,
    pub page_end: Option<i64>,
    pub document_revision: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterIndex {
    pub chapters: Vec<Chapter>,
    pub document_revision: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterInput {
    pub id: String,
    pub title: String,
    pub position: i64,
    pub status: String,
    pub note: String,
    pub page_start: Option<i64>,
    pub page_end: Option<i64>,
    pub document_revision: Option<String>,
    pub expected_version: i64,
}
fn invalid(message: &str) -> crate::store::AppError {
    backup::error("invalid_chapter_input", message)
}
pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}
impl Store {
    pub fn get_book_chapters(&self, book_id: &str) -> Result<ChapterIndex> {
        self.ensure_available()?;
        if !self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)",
            [book_id],
            |r| r.get::<_, bool>(0),
        )? {
            return Err(invalid("Choose a known book."));
        }
        let mut statement = self.conn.prepare("SELECT id,book_id,title,position,status,note,page_start,page_end,document_revision,version,created_at,updated_at FROM book_chapters WHERE book_id=?1 ORDER BY position,id")?;
        let chapters = statement
            .query_map([book_id], |r| {
                Ok(Chapter {
                    id: r.get(0)?,
                    book_id: r.get(1)?,
                    title: r.get(2)?,
                    position: r.get(3)?,
                    status: r.get(4)?,
                    note: r.get(5)?,
                    page_start: r.get(6)?,
                    page_end: r.get(7)?,
                    document_revision: r.get(8)?,
                    version: r.get(9)?,
                    created_at: r.get(10)?,
                    updated_at: r.get(11)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let document_revision = self
            .conn
            .query_row(
                "SELECT document_revision FROM book_documents WHERE book_id=?1",
                [book_id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(ChapterIndex {
            chapters,
            document_revision,
        })
    }
    pub fn save_book_chapter(
        &mut self,
        book_id: &str,
        input: ChapterInput,
    ) -> Result<ChapterIndex> {
        self.ensure_available()?;
        let _gate = backup::shared_gate(self.write_gate.as_ref())?;
        if !valid_id(&input.id)
            || input.title.trim().is_empty()
            || input.title.chars().count() > 200
            || !(1..=10000).contains(&input.position)
            || !["not_started", "reading", "read"].contains(&input.status.as_str())
            || input.note.len() > 20000
            || input.expected_version < 0
        {
            return Err(invalid("Enter a chapter title (up to 200 characters), order 1–10000, and a note under 20 KB."));
        }
        match (
            input.page_start,
            input.page_end,
            input.document_revision.as_deref(),
        ) {
            (None, None, None) => (),
            (Some(start), Some(end), Some(revision))
                if (1..=100000).contains(&start)
                    && (start..=100000).contains(&end)
                    && !revision.is_empty()
                    && revision.len() <= 100 =>
            {
                ()
            }
            _ => {
                return Err(invalid(
                    "Map both PDF page numbers to the current PDF, or leave both blank.",
                ))
            }
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        backup::ensure_epoch(&tx, &self.data_epoch)?;
        if !tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)",
            [book_id],
            |r| r.get::<_, bool>(0),
        )? {
            return Err(invalid("Choose a known book."));
        }
        let old: Option<(String,i64,String,String,Option<i64>,Option<i64>,Option<String>)> = tx.query_row("SELECT book_id,version,status,note,page_start,page_end,document_revision FROM book_chapters WHERE id=?1",[&input.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional()?;
        if old
            .as_ref()
            .is_some_and(|o| o.0 != book_id || o.1 != input.expected_version)
            || (old.is_none() && input.expected_version != 0)
        {
            return Err(backup::error("chapter_conflict","This chapter changed in another window. Reload the index before saving; your draft is still here."));
        }
        if old.is_none()
            && tx.query_row(
                "SELECT count(*) FROM book_chapters WHERE book_id=?1",
                [book_id],
                |r| r.get::<_, i64>(0),
            )? >= 500
        {
            return Err(invalid("This book already has 500 chapters."));
        }
        // An unchanged old mapping can survive PDF replacement. New/edited maps
        // must bind to the current revision, preventing stale-window page writes.
        let mapping_changed = old.as_ref().is_none_or(|o| {
            o.4 != input.page_start || o.5 != input.page_end || o.6 != input.document_revision
        });
        if mapping_changed {
            if let Some(revision) = &input.document_revision {
                let current: Option<String> = tx
                    .query_row(
                        "SELECT document_revision FROM book_documents WHERE book_id=?1",
                        [book_id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if current.as_ref() != Some(revision) {
                    return Err(invalid(
                        "The PDF changed. Reopen this book before mapping pages.",
                    ));
                }
            }
        }
        let activity_changed = old.as_ref().map_or(
            input.status != "not_started" || !input.note.trim().is_empty(),
            |o| {
                (o.2 != input.status && input.status != "not_started")
                    || (o.3 != input.note && !input.note.trim().is_empty())
            },
        );
        let timestamp = Utc::now().to_rfc3339();
        tx.execute("INSERT INTO book_chapters(id,book_id,title,position,status,note,page_start,page_end,document_revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10) ON CONFLICT(id) DO UPDATE SET title=excluded.title,position=excluded.position,status=excluded.status,note=excluded.note,page_start=excluded.page_start,page_end=excluded.page_end,document_revision=excluded.document_revision,updated_at=excluded.updated_at,version=book_chapters.version+1",params![input.id,book_id,input.title.trim(),input.position,input.status,input.note,input.page_start,input.page_end,input.document_revision,timestamp])?;
        if activity_changed {
            crate::store::record_activity(&tx)?;
        }
        tx.commit()?;
        self.get_book_chapters(book_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    fn store() -> Store {
        Store::initialize(Connection::open_in_memory().unwrap()).unwrap()
    }
    fn input(id: &str) -> ChapterInput {
        ChapterInput {
            id: id.into(),
            title: "Title from my copy".into(),
            position: 1,
            status: "not_started".into(),
            note: String::new(),
            page_start: None,
            page_end: None,
            document_revision: None,
            expected_version: 0,
        }
    }
    #[test]
    fn empty_manual_index_does_not_invent_titles_or_change_topic_progress() {
        let mut s = store();
        assert!(s.get_book_chapters("csapp").unwrap().chapters.is_empty());
        let before = serde_json::to_value(s.dashboard().unwrap()).unwrap();
        let saved = s.save_book_chapter("csapp", input("chapter-one")).unwrap();
        assert_eq!(saved.chapters[0].title, "Title from my copy");
        assert_eq!(
            serde_json::to_value(s.dashboard().unwrap()).unwrap(),
            before
        );
        assert!(s.get_book_chapters("unknown").is_err());
    }
    #[test]
    fn editing_title_order_preserves_stable_identity_progress_and_notes() {
        let mut s = store();
        let mut i = input("chapter-one");
        i.status = "read".into();
        i.note = "My private understanding".into();
        let first = s.save_book_chapter("csapp", i).unwrap().chapters.remove(0);
        let mut i = input("chapter-one");
        i.expected_version = first.version;
        i.title = "Corrected edition title".into();
        i.position = 5;
        i.status = first.status.clone();
        i.note = first.note.clone();
        let updated = s.save_book_chapter("csapp", i).unwrap().chapters.remove(0);
        assert_eq!(updated.id, first.id);
        assert_eq!(updated.created_at, first.created_at);
        assert_eq!(updated.status, "read");
        assert_eq!(updated.note, "My private understanding");
        assert_eq!(updated.position, 5);
        assert!(s.save_book_chapter("csapp", input("chapter-one")).is_err());
        assert!(s
            .save_book_chapter("optimized-cpp", input("chapter-one"))
            .is_err());
        assert_eq!(s.dashboard().unwrap().total_xp, 0);
    }
    #[test]
    fn mapping_binds_to_exact_pdf_and_replacement_keeps_reading_progress() {
        let mut s = store();
        let pdf = s
            .import_book_pdf("csapp", "first.pdf", b"%PDF-1.7\nfirst")
            .unwrap();
        let mut i = input("chapter-one");
        i.page_start = Some(3);
        i.page_end = Some(8);
        i.document_revision = Some(pdf.document_revision.clone());
        i.status = "reading".into();
        i.note = "Private note".into();
        let c = s.save_book_chapter("csapp", i).unwrap().chapters.remove(0);
        let same = s
            .import_book_pdf("csapp", "same.pdf", b"%PDF-1.7\nfirst")
            .unwrap();
        assert_eq!(same.document_revision, pdf.document_revision);
        let second = s
            .import_book_pdf("csapp", "second.pdf", b"%PDF-1.7\nsecond")
            .unwrap();
        assert_ne!(second.document_revision, pdf.document_revision);
        let index = s.get_book_chapters("csapp").unwrap();
        assert_eq!(index.chapters[0].note, "Private note");
        assert_eq!(
            index.chapters[0].document_revision.as_ref(),
            Some(&pdf.document_revision)
        );
        assert_eq!(index.document_revision, Some(second.document_revision));
        let mut unchanged = input("chapter-one");
        unchanged.expected_version = c.version;
        unchanged.page_start = c.page_start;
        unchanged.page_end = c.page_end;
        unchanged.document_revision = c.document_revision;
        unchanged.status = c.status;
        unchanged.note = "Updated note".into();
        let result = s.save_book_chapter("csapp", unchanged).unwrap();
        assert_eq!(result.chapters[0].note, "Updated note");
        let mut stale = input("chapter-two");
        stale.page_start = Some(3);
        stale.page_end = Some(8);
        stale.document_revision = Some(pdf.document_revision);
        assert!(s.save_book_chapter("csapp", stale).is_err());
    }
    #[test]
    fn rejects_bad_input_without_leaking_private_values() {
        let mut s = store();
        let mut i = input("chapter-one");
        i.note = "secret".repeat(4000);
        let error = s.save_book_chapter("csapp", i).unwrap_err();
        assert!(!error.message.contains("secret"));
        let mut i = input("chapter-one");
        i.page_start = Some(3);
        assert!(s.save_book_chapter("csapp", i).is_err());
        let mut i = input("chapter-one");
        i.title = "  ".into();
        assert!(s.save_book_chapter("csapp", i).is_err());
        assert!(s.get_book_chapters("csapp").unwrap().chapters.is_empty());
    }
    #[test]
    fn schema_seven_migrates_without_changing_existing_notes_progress_or_pdf() {
        let conn = Connection::open_in_memory().unwrap();
        for sql in [
            include_str!("../migrations/001_initial.sql"),
            include_str!("../migrations/002_reader_state.sql"),
            include_str!("../migrations/003_focus_sessions.sql"),
            include_str!("../migrations/004_spaced_review.sql"),
            include_str!("../migrations/005_backup_identity.sql"),
            include_str!("../migrations/006_project_tracking.sql"),
            include_str!("../migrations/007_credential_tracking.sql"),
        ] {
            conn.execute_batch(sql).unwrap();
        }
        conn.execute(
            "INSERT INTO books VALUES('csapp','Existing title','{}')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO topics VALUES('cache-locality','csapp','Existing topic','{}')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO topic_progress(topic_id,status) VALUES('cache-locality','reading')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes VALUES('cache-locality','Existing private note','2026-11-10')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO book_documents VALUES('csapp','private.pdf','2026-11-10',?1,'old-revision')",[b"%PDF-1.7\noriginal".as_slice()]).unwrap();
        conn.pragma_update(None, "user_version", 7).unwrap();
        let s = Store::initialize(conn).unwrap();
        assert_eq!(
            s.conn
                .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            11
        );
        assert_eq!(
            s.conn
                .query_row(
                    "SELECT body FROM notes WHERE topic_id='cache-locality'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "Existing private note"
        );
        assert_eq!(
            s.conn
                .query_row(
                    "SELECT status FROM topic_progress WHERE topic_id='cache-locality'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "reading"
        );
        assert_eq!(
            s.get_book_document("csapp")
                .unwrap()
                .unwrap()
                .document_revision,
            "old-revision"
        );
        assert!(s.get_book_chapters("csapp").unwrap().chapters.is_empty());
    }
    #[test]
    fn metadata_only_edits_and_resets_do_not_count_as_study_activity() {
        let mut s = store();
        s.save_book_chapter("csapp", input("chapter-one")).unwrap();
        assert_eq!(
            s.conn
                .query_row("SELECT count(*) FROM activity_days", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        let mut i = input("chapter-one");
        i.expected_version = 1;
        i.status = "read".into();
        s.save_book_chapter("csapp", i).unwrap();
        s.conn.execute("DELETE FROM activity_days", []).unwrap();
        let mut i = input("chapter-one");
        i.expected_version = 2;
        s.save_book_chapter("csapp", i).unwrap();
        assert_eq!(
            s.conn
                .query_row("SELECT count(*) FROM activity_days", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

#[cfg(test)]
mod backup_tests {
    use super::*;
    #[test]
    fn private_chapter_data_and_revision_maps_round_trip_through_backup() {
        let directory = tempfile::tempdir().unwrap();
        let live = directory.path().join("live.sqlite3");
        let mut s = Store::open(&live).unwrap();
        let pdf = s
            .import_book_pdf("csapp", "private-copy.pdf", b"%PDF-1.7\nprivate copy")
            .unwrap();
        s.save_book_chapter(
            "csapp",
            ChapterInput {
                id: "private-chapter".into(),
                title: "My edition title".into(),
                position: 4,
                status: "read".into(),
                note: "Private chapter evidence".into(),
                page_start: Some(4),
                page_end: Some(8),
                document_revision: Some(pdf.document_revision.clone()),
                expected_version: 0,
            },
        )
        .unwrap();
        let backup = directory.path().join("backup.sqlite3");
        s.export_backup_file(&backup).unwrap();
        s.save_book_chapter(
            "csapp",
            ChapterInput {
                id: "private-chapter".into(),
                title: "Changed title".into(),
                position: 2,
                status: "reading".into(),
                note: "New private note".into(),
                page_start: None,
                page_end: None,
                document_revision: None,
                expected_version: 1,
            },
        )
        .unwrap();
        let preview = s.inspect_backup_file(&backup).unwrap();
        assert_eq!(preview.source_schema_version, 11);
        s.restore_backup(&preview.preview_token).unwrap();
        drop(s);
        let restored = Store::open(&live).unwrap();
        let index = restored.get_book_chapters("csapp").unwrap();
        let c = &index.chapters[0];
        assert_eq!(c.id, "private-chapter");
        assert_eq!(c.title, "My edition title");
        assert_eq!(c.note, "Private chapter evidence");
        assert_eq!(c.status, "read");
        assert_eq!(c.version, 1);
        assert_eq!(c.page_start, Some(4));
        assert_eq!(c.document_revision, Some(pdf.document_revision));
        assert_eq!(
            std::fs::read_dir(directory.path())
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
                .count(),
            0
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                backup.metadata().unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
}

#[cfg(test)]
mod malformed_backup_tests {
    use super::*;
    #[test]
    fn malformed_restored_identities_and_timestamps_are_rejected_before_live_changes() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::open(directory.path().join("live.sqlite3")).unwrap();
        store
            .save_book_chapter(
                "csapp",
                ChapterInput {
                    id: "valid-chapter".into(),
                    title: "My copy".into(),
                    position: 1,
                    status: "reading".into(),
                    note: "Private live note".into(),
                    page_start: None,
                    page_end: None,
                    document_revision: None,
                    expected_version: 0,
                },
            )
            .unwrap();
        let backup = directory.path().join("backup.sqlite3");
        for (field, value) in [
            ("id", "chapter_bad"),
            ("id", "📖"),
            ("created_at", "not-a-date"),
            ("updated_at", "2026-02-30T10:00:00Z"),
        ] {
            store.export_backup_file(&backup).unwrap();
            {
                let conn = rusqlite::Connection::open(&backup).unwrap();
                conn.execute(&format!("UPDATE book_chapters SET {field}=?1"), [value])
                    .unwrap();
            }
            let error = store.inspect_backup_file(&backup).unwrap_err();
            assert_eq!(error.code, "invalid_backup");
            assert!(!error.message.contains(value));
            assert_eq!(
                store.get_book_chapters("csapp").unwrap().chapters[0].note,
                "Private live note"
            );
            assert!(store.ensure_available().is_ok());
            assert!(!directory.path().join("recovery").exists());
        }
    }
}
