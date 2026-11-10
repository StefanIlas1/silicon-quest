use crate::{
    backup,
    store::{AppError, Result},
};
use chrono::{NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
fn invalid(message: &str) -> AppError {
    backup::error("invalid_credential_input", message)
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CredentialProgress {
    pub credential_id: String,
    pub status: String,
    pub target_date: Option<String>,
    pub evidence_note: String,
    pub evidence_reference: String,
    pub completed_at: Option<String>,
    pub updated_at: Option<String>,
    pub version: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialAction {
    pub request_id: String,
    pub credential_id: String,
    pub action: String,
    pub created_at: String,
    pub snapshot: CredentialProgress,
    pub definition: Value,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSummary {
    pub items: Vec<CredentialProgress>,
    pub history: Vec<CredentialAction>,
    pub total_items: i64,
    pub in_progress_count: i64,
    pub completed_count: i64,
    pub not_pursuing_count: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialMutationResult {
    pub summary: CredentialSummary,
    pub credential_id: String,
    pub replayed: bool,
}
pub(crate) struct Effect {
    pub credential_id: String,
    pub replayed: bool,
}
pub(crate) fn identities() -> [(&'static str, &'static str, bool); 4] {
    [
        ("cuda-dli", "course_certificate", false),
        ("fpga-specialization", "specialization_certificate", false),
        ("nvidia-associate", "formal_certification", true),
        ("nvidia-modules", "optional_coursework", true),
    ]
}
pub(crate) fn seed(tx: &Transaction<'_>, curriculum: &Value) -> Result<()> {
    let definitions = curriculum["credentials"]
        .as_array()
        .ok_or_else(|| invalid("Credential definitions are unavailable."))?;
    if definitions.len() != 4 {
        return Err(invalid(
            "The four roadmap credential identities must remain stable.",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for definition in definitions {
        let id = definition["id"]
            .as_str()
            .ok_or_else(|| invalid("A credential identity is invalid."))?;
        let (_, category, optional) = identities()
            .into_iter()
            .find(|(known, _, _)| *known == id)
            .ok_or_else(|| invalid("Unsupported roadmap credential identity."))?;
        if !seen.insert(id)
            || definition["category"].as_str() != Some(category)
            || definition["optional"].as_bool() != Some(optional)
        {
            return Err(invalid("Credential classification must match the roadmap."));
        }
        let metadata = serde_json::to_string(definition)?;
        let old: Option<String> = tx
            .query_row(
                "SELECT metadata_json FROM credential_definitions WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        tx.execute("INSERT INTO credential_definitions(id,title,category,optional,metadata_json) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,optional=excluded.optional,metadata_json=excluded.metadata_json",params![id,definition["title"].as_str(),category,optional,metadata])?;
        tx.execute(
            "INSERT OR IGNORE INTO credential_progress(credential_id) VALUES(?1)",
            [id],
        )?;
        if old.as_ref().is_some_and(|old| old != &metadata) {
            tx.execute(
                "UPDATE credential_progress SET version=version+1 WHERE credential_id=?1",
                [id],
            )?;
            let request: String =
                tx.query_row("SELECT 'catalog-'||lower(hex(randomblob(16)))", [], |r| {
                    r.get(0)
                })?;
            record(tx, &request, id, "catalog_updated", "{}")?;
        }
    }
    let existing: i64 = tx.query_row("SELECT count(*) FROM credential_definitions", [], |r| {
        r.get(0)
    })?;
    if existing != 4 {
        return Err(invalid(
            "Unsupported credential removal or reassignment requires a dedicated migration.",
        ));
    }
    Ok(())
}
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<CredentialProgress> {
    Ok(CredentialProgress {
        credential_id: r.get(0)?,
        status: r.get(1)?,
        target_date: r.get(2)?,
        evidence_note: r.get(3)?,
        evidence_reference: r.get(4)?,
        completed_at: r.get(5)?,
        updated_at: r.get(6)?,
        version: r.get(7)?,
    })
}
const FIELDS:&str="credential_id,status,target_date,evidence_note,evidence_reference,completed_at,updated_at,version";
fn load(conn: &Connection, id: &str) -> Result<CredentialProgress> {
    conn.query_row(
        &format!("SELECT {FIELDS} FROM credential_progress WHERE credential_id=?1"),
        [id],
        row,
    )
    .optional()?
    .ok_or_else(|| invalid("Unknown roadmap credential."))
}
pub fn summary(conn: &Connection) -> Result<CredentialSummary> {
    let tx = conn.unchecked_transaction()?;
    let items = tx
        .prepare(&format!(
            "SELECT {FIELDS} FROM credential_progress ORDER BY credential_id"
        ))?
        .query_map([], row)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let records=tx.prepare("SELECT request_id,credential_id,action,created_at,snapshot_json,definition_json FROM credential_actions ORDER BY created_at DESC,rowid DESC LIMIT 100")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let history = records
        .into_iter()
        .map(
            |(request_id, credential_id, action, created_at, snapshot, definition)| {
                Ok(CredentialAction {
                    request_id,
                    credential_id,
                    action,
                    created_at,
                    snapshot: serde_json::from_str(&snapshot)?,
                    definition: serde_json::from_str(&definition)?,
                })
            },
        )
        .collect::<Result<Vec<_>>>()?;
    let total_items = items.len() as i64;
    let in_progress_count = items.iter().filter(|c| c.status == "in_progress").count() as i64;
    let completed_count = items.iter().filter(|c| c.status == "completed").count() as i64;
    let not_pursuing_count = items.iter().filter(|c| c.status == "not_pursuing").count() as i64;
    tx.commit()?;
    Ok(CredentialSummary {
        items,
        history,
        total_items,
        in_progress_count,
        completed_count,
        not_pursuing_count,
    })
}
fn record(
    tx: &Transaction<'_>,
    request: &str,
    id: &str,
    action: &str,
    payload: &str,
) -> Result<()> {
    let state = load(tx, id)?;
    let definition: String = tx.query_row(
        "SELECT metadata_json FROM credential_definitions WHERE id=?1",
        [id],
        |r| r.get(0),
    )?;
    tx.execute("INSERT INTO credential_actions(request_id,credential_id,action,payload_json,snapshot_json,definition_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![request,id,action,payload,serde_json::to_string(&state)?,definition,Utc::now().to_rfc3339()])?;
    Ok(())
}
fn target_date(value: Option<&str>) -> Result<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.starts_with("0000-") {
        return Err(invalid(
            "Target date must use a civil calendar year from 0001 through 9999.",
        ));
    }
    if value.len() != 10
        || value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
        || !value
            .bytes()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return Err(invalid(
            "Target date must be a calendar date in YYYY-MM-DD format.",
        ));
    }
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| {
        invalid("Choose a real calendar date, including a valid day for its month.")
    })?;
    if parsed.format("%Y-%m-%d").to_string() != value {
        return Err(invalid("Target date must use the exact YYYY-MM-DD format."));
    }
    Ok(Some(value.into()))
}
fn text(value: &str, max: usize, multiline: bool) -> Result<String> {
    let value = value.trim();
    if value.len() > max
        || value
            .chars()
            .any(|c| c.is_control() && !(multiline && ['\n', '\r', '\t'].contains(&c)))
    {
        return Err(invalid(&format!(
            "Evidence text exceeds {max} bytes or contains unsupported control characters."
        )));
    }
    Ok(value.into())
}
pub(crate) fn save(
    conn: &mut Connection,
    epoch: &str,
    id: &str,
    status: &str,
    target: Option<&str>,
    note: &str,
    reference: &str,
    confirmed: bool,
    expected: i64,
    request: &str,
) -> Result<Effect> {
    if request.len() < 8
        || request.len() > 128
        || !request
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(invalid(
            "Use a unique credential request ID of 8–128 letters, digits, hyphens or underscores.",
        ));
    }
    if ![
        "not_started",
        "in_progress",
        "on_hold",
        "completed",
        "not_pursuing",
    ]
    .contains(&status)
    {
        return Err(invalid("Choose a supported personal study status."));
    }
    let target = target_date(target)?;
    let note = text(note, 20_000, true)?;
    let reference = text(reference, 2048, false)?;
    if status == "completed" && (!confirmed || note.chars().count() < 20) {
        return Err(invalid("Self-reported completion requires at least 20 characters of concrete evidence and explicit acknowledgement. It is not external credential verification."));
    }
    let payload =
        serde_json::to_string(&(status, &target, &note, &reference, confirmed, expected))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    backup::ensure_epoch(&tx, epoch)?;
    let previous: Option<(String, String)> = tx
        .query_row(
            "SELECT credential_id,payload_json FROM credential_actions WHERE request_id=?1",
            [request],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((old_id, old_payload)) = previous {
        if old_id != id || old_payload != payload {
            return Err(invalid(
                "This credential request ID was already used for different changes.",
            ));
        }
        tx.commit()?;
        return Ok(Effect {
            credential_id: id.into(),
            replayed: true,
        });
    }
    let current = load(&tx, id)?;
    if expected < 0 || expected != current.version {
        return Err(backup::error("stale_credential_state","This study record changed in another view. Refresh it and compare your preserved draft before saving."));
    }
    let version = expected
        .checked_add(1)
        .ok_or_else(|| invalid("The credential version is outside the supported range."))?;
    let timestamp = Utc::now().to_rfc3339();
    let completed = if status == "completed" {
        current.completed_at.or_else(|| Some(timestamp.clone()))
    } else {
        None
    };
    tx.execute("UPDATE credential_progress SET status=?2,target_date=?3,evidence_note=?4,evidence_reference=?5,completed_at=?6,updated_at=?7,version=?8 WHERE credential_id=?1",params![id,status,target,note,reference,completed,timestamp,version])?;
    record(&tx, request, id, "saved", &payload)?;
    tx.commit()?;
    Ok(Effect {
        credential_id: id.into(),
        replayed: false,
    })
}
pub(crate) fn validate_integrity(conn: &Connection) -> Result<()> {
    let summary = summary(conn)?;
    for item in &summary.items {
        target_date(item.target_date.as_deref())?;
        text(&item.evidence_note, 20_000, true)?;
        text(&item.evidence_reference, 2048, false)?;
        if item.status == "completed"
            && (item.evidence_note.trim().chars().count() < 20 || item.completed_at.is_none())
        {
            return Err(invalid(
                "A completed study record is missing its self-reported evidence.",
            ));
        }
        if let Some(time) = &item.completed_at {
            chrono::DateTime::parse_from_rfc3339(time)
                .map_err(|_| invalid("A self-report timestamp is invalid."))?;
        }
    }
    let mut matched = std::collections::HashSet::new();
    let mut statement=conn.prepare("SELECT credential_id,action,payload_json,snapshot_json,definition_json FROM credential_actions")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let action: String = row.get(1)?;
        let payload: String = row.get(2)?;
        let snapshot: String = row.get(3)?;
        let definition: String = row.get(4)?;
        if payload.len() > 100_000 || snapshot.len() > 100_000 || definition.len() > 100_000 {
            return Err(invalid(
                "A credential history record exceeds the supported size.",
            ));
        }
        let payload: Value = serde_json::from_str(&payload)?;
        let _: Value = serde_json::from_str(&definition)?;
        let snapshot: CredentialProgress = serde_json::from_str(&snapshot)?;
        if snapshot.credential_id != id {
            return Err(invalid("A credential history identity is inconsistent."));
        }
        if action == "saved" && snapshot.status == "completed" {
            if payload.get(4).and_then(Value::as_bool) != Some(true) {
                return Err(invalid("A completed study snapshot is missing its explicit self-report acknowledgement."));
            }
            if let Some(current) = summary
                .items
                .iter()
                .find(|c| c.credential_id == id && c.status == "completed")
            {
                if snapshot.completed_at == current.completed_at
                    && snapshot.target_date == current.target_date
                    && snapshot.evidence_note == current.evidence_note
                    && snapshot.evidence_reference == current.evidence_reference
                {
                    matched.insert(id);
                }
            }
        }
    }
    if summary
        .items
        .iter()
        .any(|c| c.status == "completed" && !matched.contains(&c.credential_id))
    {
        return Err(invalid(
            "A completed study record has no matching explicit self-report history.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    const EVIDENCE:&str="Personal completion evidence is recorded in my study notes and the referenced document; this is a self-report only.";
    fn database() -> Store {
        Store::initialize(Connection::open_in_memory().unwrap()).unwrap()
    }
    fn state(store: &Store, id: &str) -> CredentialProgress {
        store
            .get_credential_summary()
            .unwrap()
            .items
            .into_iter()
            .find(|c| c.credential_id == id)
            .unwrap()
    }
    #[test]
    fn four_correctly_classified_plans_start_without_personal_progress_or_xp() {
        let store = database();
        let summary = store.get_credential_summary().unwrap();
        assert_eq!(summary.total_items, 4);
        assert_eq!(summary.completed_count, 0);
        assert_eq!(summary.in_progress_count, 0);
        assert!(summary.history.is_empty());
        assert!(summary.items.iter().all(|c| c.status == "not_started"
            && c.version == 0
            && c.target_date.is_none()
            && c.evidence_note.is_empty()
            && c.evidence_reference.is_empty()
            && c.completed_at.is_none()));
        for (id, category, optional) in identities() {
            let stored: (String, bool) = store
                .conn
                .query_row(
                    "SELECT category,optional FROM credential_definitions WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(stored, (category.into(), optional));
        }
        assert_eq!(store.dashboard().unwrap().total_xp, 0);
    }
    #[test]
    fn target_dates_are_strict_real_calendar_dates_and_never_automatic_completion() {
        for invalid in [
            "0000-01-01",
            "2027-02-29",
            "2026-13-01",
            "2026-00-01",
            "2026-04-31",
            "2026-1-02",
            "2026-01-2",
            "2026-01-01T00:00:00Z",
            " 2026-01-01",
            "",
            "2026/01/01",
        ] {
            assert!(target_date(Some(invalid)).is_err(), "{invalid}");
        }
        assert_eq!(
            target_date(Some("2028-02-29")).unwrap().as_deref(),
            Some("2028-02-29")
        );
        assert!(target_date(None).unwrap().is_none());
        let mut store = database();
        let result = store
            .save_credential_progress(
                "cuda-dli",
                "in_progress",
                Some("2027-02-28"),
                "Studying notes",
                "./study-notes.md",
                false,
                0,
                "credential-target-save",
            )
            .unwrap();
        assert_eq!(result.summary.in_progress_count, 1);
        assert_eq!(result.summary.completed_count, 0);
        assert_eq!(
            state(&store, "cuda-dli").target_date.as_deref(),
            Some("2027-02-28")
        );
    }
    #[test]
    fn completion_requires_evidence_and_acknowledgement_and_never_awards_xp() {
        let mut store = database();
        assert!(store
            .save_credential_progress(
                "nvidia-associate",
                "completed",
                None,
                EVIDENCE,
                "paper record",
                false,
                0,
                "no-completion-ack"
            )
            .is_err());
        assert!(store
            .save_credential_progress(
                "nvidia-associate",
                "completed",
                None,
                "done",
                "paper record",
                true,
                0,
                "short-completion-evidence"
            )
            .is_err());
        assert_eq!(state(&store, "nvidia-associate").version, 0);
        let result = store
            .save_credential_progress(
                "nvidia-associate",
                "completed",
                None,
                EVIDENCE,
                "paper record",
                true,
                0,
                "explicit-completion",
            )
            .unwrap();
        assert_eq!(result.summary.completed_count, 1);
        assert!(state(&store, "nvidia-associate").completed_at.is_some());
        assert_eq!(store.dashboard().unwrap().total_xp, 0);
        assert!(store.dashboard().unwrap().achievements.is_empty());
        assert_eq!(store.get_review_summary().unwrap().total_scheduled, 0);
        assert_eq!(
            store
                .get_project_summary()
                .unwrap()
                .completed_required_milestones,
            0
        );
        let first = state(&store, "nvidia-associate").completed_at;
        store
            .save_credential_progress(
                "nvidia-associate",
                "completed",
                Some("2027-01-01"),
                EVIDENCE,
                "new reference",
                true,
                1,
                "updated-completion-reference",
            )
            .unwrap();
        assert_eq!(state(&store, "nvidia-associate").completed_at, first);
        store
            .save_credential_progress(
                "nvidia-associate",
                "on_hold",
                None,
                "I am rechecking these records",
                "paper record",
                false,
                2,
                "reopen-personal-study",
            )
            .unwrap();
        assert!(state(&store, "nvidia-associate").completed_at.is_none());
        assert_eq!(store.get_credential_summary().unwrap().completed_count, 0);
        assert_eq!(store.get_credential_summary().unwrap().history.len(), 3);
    }
    #[test]
    fn request_replays_are_idempotent_and_conflicts_versions_and_invalid_input_are_safe() {
        let mut store = database();
        store
            .save_credential_progress(
                "cuda-dli",
                "in_progress",
                None,
                "Notes",
                "",
                false,
                0,
                "credential-first-save",
            )
            .unwrap();
        let replay = store
            .save_credential_progress(
                "cuda-dli",
                "in_progress",
                None,
                "Notes",
                "",
                false,
                0,
                "credential-first-save",
            )
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.summary.history.len(), 1);
        assert_eq!(state(&store, "cuda-dli").version, 1);
        assert!(store
            .save_credential_progress(
                "cuda-dli",
                "on_hold",
                None,
                "Changed",
                "",
                false,
                0,
                "credential-first-save"
            )
            .is_err());
        assert_eq!(
            store
                .save_credential_progress(
                    "cuda-dli",
                    "on_hold",
                    None,
                    "Notes",
                    "",
                    false,
                    0,
                    "credential-stale-save"
                )
                .unwrap_err()
                .code,
            "stale_credential_state"
        );
        assert!(store
            .save_credential_progress(
                "unknown",
                "in_progress",
                None,
                "Notes",
                "",
                false,
                0,
                "credential-unknown-save"
            )
            .is_err());
        assert!(store
            .save_credential_progress(
                "cuda-dli",
                "officially_verified",
                None,
                "Notes",
                "",
                false,
                1,
                "credential-invalid-status"
            )
            .is_err());
        assert!(store
            .save_credential_progress(
                "cuda-dli",
                "in_progress",
                None,
                &"x".repeat(20001),
                "",
                false,
                1,
                "credential-large-note"
            )
            .is_err());
        assert!(store
            .save_credential_progress(
                "cuda-dli",
                "in_progress",
                None,
                "Notes",
                "bad\0reference",
                false,
                1,
                "credential-control-reference"
            )
            .is_err());
        assert_eq!(state(&store, "cuda-dli").version, 1);
    }
    #[test]
    fn completion_and_history_persist_and_catalog_labels_do_not_revoke_personal_report() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("credentials.sqlite3");
        let timestamp;
        {
            let mut store = Store::open(&path).unwrap();
            store
                .save_credential_progress(
                    "fpga-specialization",
                    "completed",
                    Some("2027-12-01"),
                    EVIDENCE,
                    "./certificate.pdf",
                    true,
                    0,
                    "persistent-credential-report",
                )
                .unwrap();
            timestamp = state(&store, "fpga-specialization").completed_at;
        }
        let mut store = Store::open(&path).unwrap();
        assert_eq!(state(&store, "fpga-specialization").completed_at, timestamp);
        assert_eq!(store.get_credential_summary().unwrap().history.len(), 1);
        let mut data: Value =
            serde_json::from_str(include_str!("../../curriculum/data.json")).unwrap();
        data["credentials"][1]["description"] = Value::String(
            "Clarified source description; no professional certification is implied.".into(),
        );
        let tx = store.conn.transaction().unwrap();
        seed(&tx, &data).unwrap();
        tx.commit().unwrap();
        let current = state(&store, "fpga-specialization");
        assert_eq!(current.status, "completed");
        assert_eq!(current.completed_at, timestamp);
        assert_eq!(current.version, 2);
        assert_eq!(
            store.get_credential_summary().unwrap().history[0].action,
            "catalog_updated"
        );
        validate_integrity(&store.conn).unwrap();
        assert_eq!(store.dashboard().unwrap().total_xp, 0);
    }
    #[test]
    fn audit_failure_rolls_back_and_competing_updates_reject_stale_versions() {
        let mut store = database();
        store.conn.execute_batch("CREATE TRIGGER fail_credential_action BEFORE INSERT ON credential_actions BEGIN SELECT RAISE(ABORT,'forced failure'); END;").unwrap();
        assert!(store
            .save_credential_progress(
                "cuda-dli",
                "completed",
                None,
                EVIDENCE,
                "",
                true,
                0,
                "credential-rollback"
            )
            .is_err());
        assert_eq!(state(&store, "cuda-dli").status, "not_started");
        assert!(store.get_credential_summary().unwrap().history.is_empty());
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("concurrent.sqlite3");
        let mut first = Store::open(&path).unwrap();
        let mut second = Store::open(&path).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let other = barrier.clone();
        let a = std::thread::spawn(move || {
            barrier.wait();
            first.save_credential_progress(
                "cuda-dli",
                "in_progress",
                None,
                "Notes",
                "",
                false,
                0,
                "concurrent-credential-a",
            )
        });
        let b = std::thread::spawn(move || {
            other.wait();
            second.save_credential_progress(
                "cuda-dli",
                "on_hold",
                None,
                "Notes",
                "",
                false,
                0,
                "concurrent-credential-b",
            )
        });
        let outcomes = [a.join().unwrap(), b.join().unwrap()];
        assert_eq!(outcomes.iter().filter(|r| r.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter(|r| r
                    .as_ref()
                    .is_err_and(|e| e.code == "stale_credential_state"))
                .count(),
            1
        );
    }
}
