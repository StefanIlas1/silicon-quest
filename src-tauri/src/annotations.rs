//! Page annotations are private sidecar data, never modifications to the PDF.
use crate::{
    backup,
    store::{Result, Store},
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HighlightRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PdfAnnotation {
    pub id: String,
    pub page: i64,
    pub body: String,
    pub quote: Option<String>,
    pub rects: Vec<HighlightRect>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationInput {
    pub id: String,
    pub page: i64,
    pub body: String,
    pub quote: Option<String>,
    pub rects: Vec<HighlightRect>,
    pub expected_version: i64,
}
fn invalid(message: &str) -> crate::store::AppError {
    backup::error("invalid_annotation", message)
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
fn valid_body(body: &str) -> bool {
    body.len() <= 20000
        && !body
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
}
fn valid_anchor(body: &str, quote: Option<&str>, rects: &[HighlightRect]) -> bool {
    valid_body(body)
        && match quote {
            None => !body.trim().is_empty() && rects.is_empty(),
            Some(quote) => {
                !quote.trim().is_empty()
                    && quote.len() <= 10000
                    && valid_body(quote)
                    && !rects.is_empty()
                    && rects.len() <= 200
                    && rects.iter().all(|r| {
                        [r.x, r.y, r.width, r.height].iter().all(|v| v.is_finite())
                            && r.x >= 0.0
                            && r.y >= 0.0
                            && r.width > 0.0
                            && r.height > 0.0
                            && r.x + r.width <= 1.000001
                            && r.y + r.height <= 1.000001
                    })
            }
        }
}
fn revision(conn: &Connection, book: &str, expected: &str) -> Result<()> {
    let current: Option<String> = conn
        .query_row(
            "SELECT document_revision FROM book_documents WHERE book_id=?1",
            [book],
            |r| r.get(0),
        )
        .optional()?;
    if expected.len() != 32
        || !expected.bytes().all(|b| b.is_ascii_hexdigit())
        || current.as_deref() != Some(expected)
    {
        return Err(backup::error(
            "document_changed",
            "The PDF changed or is unavailable. Reopen this book before using its annotations.",
        ));
    }
    Ok(())
}
fn list(conn: &Connection, book: &str, document: &str) -> Result<Vec<PdfAnnotation>> {
    Ok(conn.prepare("SELECT id,page,body,version,created_at,updated_at,quote,rects_json FROM pdf_annotations WHERE book_id=?1 AND document_revision=?2 AND deleted_at IS NULL ORDER BY page,created_at,id")?.query_map(params![book,document], |r| Ok(PdfAnnotation {id:r.get(0)?,page:r.get(1)?,body:r.get(2)?,version:r.get(3)?,created_at:r.get(4)?,updated_at:r.get(5)?,quote:r.get(6)?,rects:serde_json::from_str(&r.get::<_,String>(7)?).map_err(|e|rusqlite::Error::FromSqlConversionFailure(7,rusqlite::types::Type::Text,Box::new(e)))?}))?.collect::<std::result::Result<Vec<_>,_>>()?)
}
impl Store {
    pub fn get_pdf_annotations(&self, book: &str, document: &str) -> Result<Vec<PdfAnnotation>> {
        self.ensure_available()?;
        let tx = self.conn.unchecked_transaction()?;
        revision(&tx, book, document)?;
        let result = list(&tx, book, document)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn save_pdf_annotation(
        &mut self,
        book: &str,
        document: &str,
        input: AnnotationInput,
    ) -> Result<Vec<PdfAnnotation>> {
        self.ensure_available()?;
        let _gate = backup::shared_gate(self.write_gate.as_ref())?;
        if !valid_id(&input.id)
            || !(1..=100000).contains(&input.page)
            || !valid_anchor(&input.body, input.quote.as_deref(), &input.rects)
            || input.expected_version < 0
            || input.expected_version == i64::MAX
        {
            return Err(invalid(
                "Enter a page note under 20 KB on a valid PDF page.",
            ));
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        backup::ensure_epoch(&tx, &self.data_epoch)?;
        revision(&tx, book, document)?;
        let old: Option<(String,String,i64,String,i64,Option<String>,Option<String>,String)> = tx.query_row("SELECT book_id,document_revision,page,body,version,deleted_at,quote,rects_json FROM pdf_annotations WHERE id=?1", [&input.id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?))).optional()?;
        // An exact replay after a lost response acknowledges the original save.
        let replay = old.as_ref().is_some_and(|o| {
            o.0 == book
                && o.1 == document
                && o.2 == input.page
                && o.3 == input.body
                && o.4 == input.expected_version + 1
                && o.5.is_none()
                && o.6 == input.quote
                && serde_json::from_str::<Vec<HighlightRect>>(&o.7)
                    .ok()
                    .as_deref()
                    == Some(input.rects.as_slice())
        });
        if !replay {
            if old.as_ref().is_some_and(|o| {
                o.0 != book || o.1 != document || o.4 != input.expected_version || o.5.is_some()
            }) || (old.is_none() && input.expected_version != 0)
            {
                return Err(backup::error("annotation_conflict", "This annotation changed in another window. Reload annotations before saving; keep your draft to copy it."));
            }
            if old.is_none() && tx.query_row("SELECT count(*) FROM pdf_annotations WHERE book_id=?1 AND document_revision=?2",params![book,document],|r|r.get::<_,i64>(0))? >= 2000 {
                return Err(invalid("This PDF revision already has 2000 annotation records."));
            }
            let timestamp = Utc::now().to_rfc3339();
            tx.execute("INSERT INTO pdf_annotations(id,book_id,document_revision,page,body,created_at,updated_at,quote,rects_json) VALUES(?1,?2,?3,?4,?5,?6,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET page=excluded.page,body=excluded.body,quote=excluded.quote,rects_json=excluded.rects_json,version=pdf_annotations.version+1,updated_at=excluded.updated_at",params![input.id,book,document,input.page,input.body,timestamp,input.quote,serde_json::to_string(&input.rects)?])?;
        }
        let result = list(&tx, book, document)?;
        tx.commit()?;
        Ok(result)
    }
    pub fn remove_pdf_annotation(
        &mut self,
        book: &str,
        document: &str,
        id: &str,
        expected_version: i64,
    ) -> Result<Vec<PdfAnnotation>> {
        self.ensure_available()?;
        let _gate = backup::shared_gate(self.write_gate.as_ref())?;
        if !valid_id(id) || expected_version < 1 || expected_version == i64::MAX {
            return Err(invalid("Choose a saved annotation to remove."));
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        backup::ensure_epoch(&tx, &self.data_epoch)?;
        revision(&tx, book, document)?;
        let old: Option<(i64,Option<String>)> = tx.query_row("SELECT version,deleted_at FROM pdf_annotations WHERE id=?1 AND book_id=?2 AND document_revision=?3",params![id,book,document],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        match old {
            Some((version, None)) if version == expected_version => {
                let timestamp = Utc::now().to_rfc3339();
                tx.execute("UPDATE pdf_annotations SET version=version+1,updated_at=?2,deleted_at=?2 WHERE id=?1",params![id,timestamp])?;
            }
            Some((version, Some(_))) if version == expected_version + 1 => (),
            _ => return Err(backup::error(
                "annotation_conflict",
                "This annotation changed in another window. Reload annotations before removing it.",
            )),
        }
        let result = list(&tx, book, document)?;
        tx.commit()?;
        Ok(result)
    }
}
pub(crate) fn validate_integrity(conn: &Connection) -> Result<()> {
    if conn.query_row("SELECT count(*) FROM pdf_annotations",[],|r|r.get::<_,i64>(0))? > 200000 || conn.prepare("SELECT 1 FROM pdf_annotations GROUP BY book_id,document_revision HAVING count(*)>2000")?.exists([])? {
        return Err(invalid("The annotation history exceeds supported limits."));
    }
    let mut statement = conn.prepare("SELECT id,document_revision,page,body,version,created_at,updated_at,deleted_at,quote,rects_json FROM pdf_annotations")?;
    let mut rows = statement.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let document: String = r.get(1)?;
        let page: i64 = r.get(2)?;
        let body: String = r.get(3)?;
        let version: i64 = r.get(4)?;
        let created: String = r.get(5)?;
        let updated: String = r.get(6)?;
        let deleted: Option<String> = r.get(7)?;
        let quote: Option<String> = r.get(8)?;
        let rects_json: String = r.get(9)?;
        if rects_json.len() > 50000 {
            return Err(invalid("Oversized highlight anchor."));
        }
        let rects: Vec<HighlightRect> =
            serde_json::from_str(&rects_json).map_err(|_| invalid("Invalid highlight anchor."))?;
        if !valid_id(&id)
            || document.len() != 32
            || !document.bytes().all(|b| b.is_ascii_hexdigit())
            || !(1..=100000).contains(&page)
            || !valid_anchor(&body, quote.as_deref(), &rects)
            || version < 1
            || version == i64::MAX
            || chrono::DateTime::parse_from_rfc3339(&created).is_err()
            || chrono::DateTime::parse_from_rfc3339(&updated).is_err()
            || deleted
                .as_ref()
                .is_some_and(|d| chrono::DateTime::parse_from_rfc3339(d).is_err())
        {
            return Err(invalid("The backup contains invalid annotation data."));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(id: &str, version: i64, body: &str) -> AnnotationInput {
        AnnotationInput {
            id: id.into(),
            page: 7,
            body: body.into(),
            quote: None,
            rects: vec![],
            expected_version: version,
        }
    }
    fn highlight(id: &str) -> AnnotationInput {
        AnnotationInput {
            quote: Some("Spatial locality".into()),
            rects: vec![HighlightRect {
                x: 0.1,
                y: 0.2,
                width: 0.4,
                height: 0.03,
            }],
            ..input(id, 0, "")
        }
    }
    #[test]
    fn notes_highlights_and_delete_survive_restart_without_modifying_pdf() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("live.sqlite3");
        let revision;
        {
            let mut s = Store::open(&path).unwrap();
            revision = s
                .import_book_pdf("csapp", "my.pdf", b"%PDF-1.7\nprivate content")
                .unwrap()
                .document_revision;
            s.save_pdf_annotation(
                "csapp",
                &revision,
                input("note-one", 0, "My private insight\nSecond line"),
            )
            .unwrap();
            s.save_pdf_annotation("csapp", &revision, highlight("highlight-one"))
                .unwrap();
            // Lost response retry does not duplicate a highlight or increment its version.
            assert_eq!(
                s.save_pdf_annotation("csapp", &revision, highlight("highlight-one"))
                    .unwrap()[1]
                    .version,
                1
            );
            s.save_pdf_annotation(
                "csapp",
                &revision,
                input("note-one", 1, "Updated private insight"),
            )
            .unwrap();
        }
        let mut s = Store::open(&path).unwrap();
        let a = s.get_pdf_annotations("csapp", &revision).unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!(a[0].body, "Updated private insight");
        assert_eq!(a[0].version, 2);
        assert_eq!(a[1].quote.as_deref(), Some("Spatial locality"));
        assert_eq!(a[1].rects[0].width, 0.4);
        assert_eq!(
            s.get_book_pdf_for_revision("csapp", Some(&revision))
                .unwrap(),
            b"%PDF-1.7\nprivate content"
        );
        s.remove_pdf_annotation("csapp", &revision, "note-one", 2)
            .unwrap();
        s.remove_pdf_annotation("csapp", &revision, "note-one", 2)
            .unwrap();
        drop(s);
        assert_eq!(
            Store::open(path)
                .unwrap()
                .get_pdf_annotations("csapp", &revision)
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn replacement_and_other_books_cannot_receive_old_annotations_or_stale_writes() {
        let mut s = Store::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let revision = s
            .import_book_pdf("csapp", "my.pdf", b"%PDF-1.7\none")
            .unwrap()
            .document_revision;
        s.save_pdf_annotation("csapp", &revision, input("note-one", 0, "Edition-specific"))
            .unwrap();
        let identical = s
            .import_book_pdf("csapp", "renamed.pdf", b"%PDF-1.7\none")
            .unwrap();
        assert_eq!(identical.document_revision, revision);
        assert_eq!(s.get_pdf_annotations("csapp", &revision).unwrap().len(), 1);
        let other = s
            .import_book_pdf("optimized-cpp", "other.pdf", b"%PDF-1.7\none")
            .unwrap()
            .document_revision;
        assert!(s
            .save_pdf_annotation("optimized-cpp", &other, input("note-one", 1, "Wrong book"))
            .is_err());
        let replacement = s
            .import_book_pdf("csapp", "new.pdf", b"%PDF-1.7\ntwo")
            .unwrap()
            .document_revision;
        assert!(s.get_pdf_annotations("csapp", &revision).is_err());
        assert!(s
            .save_pdf_annotation("csapp", &revision, input("stale", 0, "Stale text"))
            .is_err());
        assert!(s
            .remove_pdf_annotation("csapp", &revision, "note-one", 1)
            .is_err());
        assert!(s
            .get_pdf_annotations("csapp", &replacement)
            .unwrap()
            .is_empty());
        assert_eq!(
            s.conn
                .query_row(
                    "SELECT body FROM pdf_annotations WHERE id='note-one'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "Edition-specific"
        );
    }
    #[test]
    fn optimistic_versions_prevent_lost_updates_and_deleted_note_resurrection() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("live.sqlite3");
        let mut first = Store::open(&path).unwrap();
        let revision = first
            .import_book_pdf("csapp", "my.pdf", b"%PDF-1.7\nprivate")
            .unwrap()
            .document_revision;
        first
            .save_pdf_annotation("csapp", &revision, input("note", 0, "Initial"))
            .unwrap();
        let mut second = Store::open(&path).unwrap();
        first
            .save_pdf_annotation("csapp", &revision, input("note", 1, "Window one"))
            .unwrap();
        assert_eq!(
            second
                .save_pdf_annotation("csapp", &revision, input("note", 1, "Window two"))
                .unwrap_err()
                .code,
            "annotation_conflict"
        );
        assert!(second
            .remove_pdf_annotation("csapp", &revision, "note", 1)
            .is_err());
        first
            .remove_pdf_annotation("csapp", &revision, "note", 2)
            .unwrap();
        assert!(second
            .save_pdf_annotation("csapp", &revision, input("note", 3, "Resurrect"))
            .is_err());
    }
    #[test]
    fn invalid_notes_and_geometry_are_rejected_without_leaking_text() {
        let mut s = Store::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let revision = s
            .import_book_pdf("csapp", "my.pdf", b"%PDF-1.7\nprivate")
            .unwrap()
            .document_revision;
        for text in [
            "".into(),
            "  ".into(),
            "private".repeat(3000),
            "private\0text".into(),
        ] {
            let e = s
                .save_pdf_annotation("csapp", &revision, input("note", 0, &text))
                .unwrap_err();
            assert!(!e.message.contains("private"));
        }
        for rect in [
            HighlightRect {
                x: -0.1,
                y: 0.2,
                width: 0.1,
                height: 0.1,
            },
            HighlightRect {
                x: 0.9,
                y: 0.2,
                width: 0.2,
                height: 0.1,
            },
            HighlightRect {
                x: f64::NAN,
                y: 0.2,
                width: 0.1,
                height: 0.1,
            },
            HighlightRect {
                x: 0.1,
                y: 0.2,
                width: 0.0,
                height: 0.1,
            },
        ] {
            let mut i = highlight("highlight");
            i.rects = vec![rect];
            assert!(s.save_pdf_annotation("csapp", &revision, i).is_err());
        }
        let mut i = highlight("highlight");
        i.rects = vec![];
        assert!(s.save_pdf_annotation("csapp", &revision, i).is_err());
        assert!(s
            .get_pdf_annotations("csapp", &revision)
            .unwrap()
            .is_empty());
    }
    #[test]
    fn private_annotations_roundtrip_backup_and_malformed_anchors_are_rejected_before_live_changes()
    {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("live.sqlite3");
        let backup = d.path().join("saved.sqlite3");
        let mut s = Store::open(&path).unwrap();
        let revision = s
            .import_book_pdf("csapp", "my.pdf", b"%PDF-1.7\nprivate")
            .unwrap()
            .document_revision;
        s.save_pdf_annotation("csapp", &revision, highlight("highlight"))
            .unwrap();
        s.save_pdf_annotation("csapp", &revision, input("note", 0, "Private note"))
            .unwrap();
        s.export_backup_file(&backup).unwrap();
        s.remove_pdf_annotation("csapp", &revision, "highlight", 1)
            .unwrap();
        let preview = s.inspect_backup_file(&backup).unwrap();
        assert_eq!(preview.source_schema_version, 10);
        s.restore_backup(&preview.preview_token).unwrap();
        drop(s);
        let mut restored = Store::open(&path).unwrap();
        assert_eq!(
            restored
                .get_pdf_annotations("csapp", &revision)
                .unwrap()
                .len(),
            2
        );
        for (field, value) in [
            ("rects_json", "[{\"x\":2,\"y\":0,\"width\":1,\"height\":1}]"),
            ("quote", ""),
            ("updated_at", "invalid"),
            ("document_revision", "z2345678901234567890123456789012"),
        ] {
            restored.export_backup_file(&backup).unwrap();
            let bad = Connection::open(&backup).unwrap();
            // Only the quote-empty case bypasses a SQL check to exercise domain validation.
            bad.pragma_update(None, "ignore_check_constraints", true)
                .unwrap();
            bad.execute(
                &format!("UPDATE pdf_annotations SET {field}=?1 WHERE id='highlight'"),
                [value],
            )
            .unwrap();
            drop(bad);
            assert_eq!(
                restored.inspect_backup_file(&backup).unwrap_err().code,
                "invalid_backup"
            );
            assert_eq!(
                restored
                    .get_pdf_annotations("csapp", &revision)
                    .unwrap()
                    .len(),
                2
            );
            assert!(restored.ensure_available().is_ok());
        }
    }
}
