use crate::store::{AppError, Result, Store};
use chrono::Utc;
use rusqlite::{
    backup::{Backup, StepResult},
    Connection, OpenFlags, OptionalExtension,
};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
const CURRENT_SCHEMA: i64 = 6;
const APPLICATION_ID: i64 = 1397836881;
const MAX_BACKUP_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const PREVIEW_LIFETIME: Duration = Duration::from_secs(15 * 60);
pub(crate) fn error(code: &'static str, message: &str) -> AppError {
    AppError {
        code,
        message: message.into(),
    }
}
fn io_error(_: std::io::Error) -> AppError {
    error("backup_io","The local backup file operation failed. Your current workspace was preserved. Check available disk space and file permissions.")
}
fn invalid(message: &str) -> AppError {
    error("invalid_backup", message)
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupCounts {
    pub topics: i64,
    pub attempts: i64,
    pub notes: i64,
    pub pdfs: i64,
    pub pdf_bytes: i64,
    pub focus_sessions: i64,
    pub tracked_seconds: i64,
    pub review_topics: i64,
    pub total_xp: i64,
    pub project_milestones: i64,
    pub reviewed_milestones: i64,
    pub project_evidence_notes: i64,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    pub preview_token: String,
    pub file_name: String,
    pub created_at: Option<String>,
    pub source_schema_version: i64,
    pub current_schema_version: i64,
    pub bytes: u64,
    pub counts: BackupCounts,
    pub interrupted_sessions: i64,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub file_name: String,
    pub bytes: u64,
    pub created_at: String,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub restored: bool,
    pub restart_required: bool,
    pub safety_backup_file_name: String,
    pub safety_backup_path: String,
    pub counts: BackupCounts,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub restart_required: bool,
    pub workspace_replaced: bool,
    pub safety_backup_path: Option<String>,
}
pub(crate) struct PreparedBackup {
    candidate: Box<Store>,
    _directory: tempfile::TempDir,
    preview: BackupPreview,
    prepared_at: Instant,
}

pub(crate) fn read_epoch(conn: &Connection) -> Result<String> {
    Ok(conn.query_row(
        "SELECT value FROM app_metadata WHERE key='data_epoch'",
        [],
        |r| r.get(0),
    )?)
}
pub(crate) fn ensure_epoch(conn: &Connection, expected: &str) -> Result<()> {
    if read_epoch(conn)? != expected {
        return Err(error("workspace_replaced","Another app instance restored this workspace. Restart Silicon Quest before continuing."));
    }
    Ok(())
}
pub(crate) fn open_gate(path: &Path) -> Result<File> {
    let mut name = path.as_os_str().to_os_string();
    name.push(".restore-gate");
    let mut options = File::options();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(name).map_err(io_error)
}
pub(crate) struct GateGuard<'a>(Option<&'a File>);
impl Drop for GateGuard<'_> {
    fn drop(&mut self) {
        if let Some(file) = self.0 {
            let _ = file.unlock();
        }
    }
}
pub(crate) fn shared_gate(file: Option<&File>) -> Result<GateGuard<'_>> {
    if let Some(file) = file {
        file.try_lock_shared().map_err(|_| {
            error(
                "backup_busy",
                "A restore is in progress in another app instance. Try again after it completes.",
            )
        })?;
    }
    Ok(GateGuard(file))
}
fn exclusive_gate(file: Option<&File>) -> Result<GateGuard<'_>> {
    if let Some(file) = file {
        file.try_lock().map_err(|_| {
            error(
                "backup_busy",
                "Another app instance is saving data. Wait for it to finish before restoring.",
            )
        })?;
    }
    Ok(GateGuard(file))
}
fn private_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path).map_err(io_error)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(io_error)?;
    }
    Ok(())
}
fn online_copy(
    source: &Connection,
    destination: &mut Connection,
    fail_after_step: Option<usize>,
) -> Result<()> {
    let backup = Backup::new(source, destination)?;
    let start = Instant::now();
    let mut steps = 0;
    loop {
        let result = backup.step(if fail_after_step.is_some() { 1 } else { 256 })?;
        steps += 1;
        if result == StepResult::Done {
            return Ok(());
        }
        if fail_after_step.is_some_and(|limit| steps >= limit) {
            return Err(error("backup_interrupted","The restore copy was interrupted; its transaction was rolled back. The safety backup remains available."));
        }
        if start.elapsed() > Duration::from_secs(60) {
            return Err(error("backup_busy","The database stayed busy for too long. The unfinished copy was rolled back; try again when other app instances are idle."));
        }
        match result {
            StepResult::Busy | StepResult::Locked => std::thread::sleep(Duration::from_millis(10)),
            _ => std::thread::yield_now(),
        }
    }
}
fn aliases(a: &Path, b: &Path) -> bool {
    if a.canonicalize()
        .ok()
        .zip(b.canonicalize().ok())
        .is_some_and(|(a, b)| a == b)
    {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(a), Ok(b)) = (a.metadata(), b.metadata()) {
            if a.dev() == b.dev() && a.ino() == b.ino() {
                return true;
            }
        }
    }
    false
}
fn reserved_path(store: &Store, path: &Path) -> bool {
    let Some(live) = store.database_path.as_ref() else {
        return false;
    };
    if aliases(live, path) {
        return true;
    }
    for suffix in ["-wal", "-shm", "-journal", ".focus-lock", ".restore-gate"] {
        let mut reserved = live.as_os_str().to_os_string();
        reserved.push(suffix);
        let reserved = PathBuf::from(reserved);
        if aliases(&reserved, path) || path == reserved {
            return true;
        }
    }
    false
}
fn normalized_schema(conn: &Connection) -> Result<Vec<(String, String, String)>> {
    Ok(conn
        .prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name")?
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?
                    .unwrap_or_default()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" "),
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}
fn reference_schema(version: i64) -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    for sql in [
        include_str!("../migrations/001_initial.sql"),
        include_str!("../migrations/002_reader_state.sql"),
        include_str!("../migrations/003_focus_sessions.sql"),
        include_str!("../migrations/004_spaced_review.sql"),
        include_str!("../migrations/005_backup_identity.sql"),
        include_str!("../migrations/006_project_tracking.sql"),
    ]
    .into_iter()
    .take(version as usize)
    {
        conn.execute_batch(sql)?;
    }
    Ok(conn)
}
fn validate(path: &Path) -> Result<(i64, Option<String>, i64)> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| invalid("This file is not a readable SQLite backup."))?;
    conn.pragma_update(None, "trusted_schema", false)?;
    conn.pragma_update(None, "query_only", true)?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if !(1..=CURRENT_SCHEMA).contains(&version) {
        return Err(invalid("This backup has an unsupported schema version. Use a Silicon Quest backup with schema 1–6; newer schemas require a newer app."));
    }
    let app_id: i64 = conn.pragma_query_value(None, "application_id", |r| r.get(0))?;
    if (version >= 5 && app_id != APPLICATION_ID)
        || (version < 5 && app_id != 0 && app_id != APPLICATION_ID)
    {
        return Err(invalid(
            "This database is not identified as a Silicon Quest backup.",
        ));
    }
    if conn
        .prepare("SELECT 1 FROM sqlite_schema WHERE type IN ('trigger','view')")?
        .exists([])?
    {
        return Err(invalid("Backup triggers and views are not accepted."));
    }
    if normalized_schema(&conn)? != normalized_schema(&reference_schema(version)?)? {
        return Err(invalid("The backup schema does not match a supported Silicon Quest database. Extra triggers, views, tables or modified definitions are not accepted."));
    }
    let mut check = conn.prepare("PRAGMA integrity_check")?;
    let integrity = check
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if integrity != ["ok"] {
        return Err(invalid("The backup failed SQLite integrity validation."));
    }
    if conn.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err(invalid("The backup contains broken record references."));
    }
    let curriculum: serde_json::Value =
        serde_json::from_str(include_str!("../../curriculum/data.json"))?;
    for (table, field) in [("books", "books"), ("topics", "modules")] {
        let allowed = curriculum[field]
            .as_array()
            .ok_or_else(|| invalid("Bundled curriculum identity is unavailable."))?
            .iter()
            .filter_map(|v| v["id"].as_str())
            .collect::<std::collections::HashSet<_>>();
        let count: i64 =
            conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?;
        if count > allowed.len() as i64 {
            return Err(invalid(
                "This backup contains book or topic identities unsupported by this app.",
            ));
        }
        let mut statement = conn.prepare(&format!("SELECT id FROM {table}"))?;
        for id in statement.query_map([], |r| r.get::<_, String>(0))? {
            if !allowed.contains(id?.as_str()) {
                return Err(invalid(
                    "This backup contains a book or topic unsupported by this app.",
                ));
            }
        }
    }
    for table in ["quiz_attempts", "focus_sessions", "review_events"] {
        if (table == "focus_sessions" && version < 3) || (table == "review_events" && version < 4) {
            continue;
        }
        let count: i64 =
            conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?;
        if count > 1_000_000 {
            return Err(invalid(
                "This backup exceeds the supported one-million-row history limit.",
            ));
        }
    }
    if conn.query_row("SELECT count(*) FROM book_documents WHERE length(bytes)>104857600 OR length(bytes)<8 OR substr(bytes,1,5)<>x'255044462d'",[],|r|r.get::<_,i64>(0))?>0 {return Err(invalid("The backup contains an invalid or oversized PDF asset."));}
    if conn.query_row(
        "SELECT count(*) FROM notes WHERE length(CAST(body AS BLOB))>100000",
        [],
        |r| r.get::<_, i64>(0),
    )? > 0
    {
        return Err(invalid("The backup contains an oversized note."));
    }
    if version >= 6 {
        for (table, field) in [
            ("project_plans", "projects"),
            ("project_milestones", "projectMilestones"),
        ] {
            let allowed = curriculum[field]
                .as_array()
                .ok_or_else(|| invalid("Project definitions are unavailable."))?
                .iter()
                .filter_map(|v| v["id"].as_str())
                .collect::<std::collections::HashSet<_>>();
            let count: i64 =
                conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?;
            if count > allowed.len() as i64 {
                return Err(invalid(
                    "This backup contains unsupported project definitions.",
                ));
            }
            let mut statement = conn.prepare(&format!("SELECT id FROM {table}"))?;
            for id in statement.query_map([], |r| r.get::<_, String>(0))? {
                if !allowed.contains(id?.as_str()) {
                    return Err(invalid(
                        "This backup contains an unsupported project or milestone.",
                    ));
                }
            }
        }
        let expected_tasks = curriculum["projectMilestones"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|m| {
                m["tasks"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(move |t| Some((t["id"].as_str()?, m["id"].as_str()?)))
            })
            .collect::<std::collections::HashMap<_, _>>();
        let count: i64 = conn.query_row("SELECT count(*) FROM project_tasks", [], |r| r.get(0))?;
        if count > expected_tasks.len() as i64 {
            return Err(invalid("This backup contains unsupported project tasks."));
        }
        let mut statement = conn.prepare("SELECT id,milestone_id FROM project_tasks")?;
        for task in
            statement.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        {
            let (id, parent) = task?;
            if expected_tasks.get(id.as_str()).copied() != Some(parent.as_str()) {
                return Err(invalid(
                    "This backup contains unsupported or reassigned project tasks.",
                ));
            }
        }
        if conn.query_row("SELECT count(*) FROM project_actions", [], |r| {
            r.get::<_, i64>(0)
        })? > 1_000_000
        {
            return Err(invalid("This backup exceeds the project history limit."));
        }
        if conn.query_row("SELECT count(*) FROM project_milestone_state WHERE length(CAST(evidence_note AS BLOB))>20000 OR length(CAST(review_note AS BLOB))>10000",[],|r|r.get::<_,i64>(0))?>0 {return Err(invalid("This backup contains oversized project evidence."));}
    }
    if version >= 5 {
        let epoch = read_epoch(&conn)?;
        if epoch.len() != 32 || !epoch.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(invalid("The backup workspace identity is invalid."));
        }
    }
    let created_at = if version >= 5 {
        conn.query_row(
            "SELECT created_at FROM backup_metadata WHERE id=1",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    } else {
        None
    };
    if let Some(timestamp) = created_at.as_ref() {
        chrono::DateTime::parse_from_rfc3339(timestamp)
            .map_err(|_| invalid("The backup creation timestamp is invalid."))?;
    }
    let active = if version >= 3 {
        conn.query_row(
            "SELECT count(*) FROM focus_sessions WHERE status='active'",
            [],
            |r| r.get(0),
        )?
    } else {
        0
    };
    Ok((version, created_at, active))
}
fn counts(conn: &Connection) -> Result<BackupCounts> {
    fn scalar(conn: &Connection, sql: &str) -> Result<i64> {
        Ok(conn.query_row(sql, [], |r| r.get(0))?)
    }
    Ok(BackupCounts {
        topics: scalar(conn, "SELECT count(*) FROM topics")?,
        attempts: scalar(conn, "SELECT count(*) FROM quiz_attempts")?,
        notes: scalar(conn, "SELECT count(*) FROM notes")?,
        pdfs: scalar(conn, "SELECT count(*) FROM book_documents")?,
        pdf_bytes: scalar(
            conn,
            "SELECT COALESCE(sum(length(bytes)),0) FROM book_documents",
        )?,
        focus_sessions: scalar(conn, "SELECT count(*) FROM focus_sessions")?,
        tracked_seconds: scalar(
            conn,
            "SELECT COALESCE(sum(elapsed_ms),0)/1000 FROM focus_sessions",
        )?,
        review_topics: scalar(conn, "SELECT count(*) FROM review_schedule")?,
        total_xp: scalar(conn, "SELECT COALESCE(sum(amount),0) FROM xp_ledger")?,
        project_milestones: scalar(conn, "SELECT count(*) FROM project_milestones")?,
        reviewed_milestones: scalar(
            conn,
            "SELECT count(*) FROM project_milestone_state WHERE status='completed'",
        )?,
        project_evidence_notes: scalar(
            conn,
            "SELECT count(*) FROM project_milestone_state WHERE length(trim(evidence_note))>0",
        )?,
    })
}
fn write_snapshot(source: &Connection, destination: &Path) -> Result<ExportReport> {
    let parent = destination
        .parent()
        .ok_or_else(|| invalid("Choose a valid local destination file."))?;
    let staged = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
    let created_at = Utc::now().to_rfc3339();
    {
        let mut snapshot = Connection::open(staged.path())?;
        online_copy(source, &mut snapshot, None)?;
        snapshot.execute("INSERT INTO backup_metadata(id,format_version,created_at) VALUES(1,1,?1) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at",[&created_at])?;
        snapshot.pragma_update(None, "journal_mode", "DELETE")?;
    }
    let bytes = staged.as_file().metadata().map_err(io_error)?.len();
    if bytes > MAX_BACKUP_BYTES {
        return Err(invalid(
            "This backup is larger than the supported 2 GiB limit.",
        ));
    }
    validate(staged.path())?;
    staged.as_file().sync_all().map_err(io_error)?;
    staged.persist(destination).map_err(|e| io_error(e.error))?;
    #[cfg(unix)]
    {
        File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(io_error)?;
    }
    Ok(ExportReport {
        file_name: destination
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        bytes,
        created_at,
    })
}
impl Store {
    pub fn backup_status(&self) -> Result<BackupStatus> {
        let workspace_replaced = read_epoch(&self.conn)? != self.data_epoch;
        Ok(BackupStatus {
            restart_required: self.restore_result.is_some() || workspace_replaced,
            workspace_replaced,
            safety_backup_path: self
                .restore_result
                .as_ref()
                .map(|(_, r)| r.safety_backup_path.clone()),
        })
    }
    pub fn export_backup_file(&self, destination: &Path) -> Result<ExportReport> {
        self.ensure_available()?;
        if reserved_path(self, destination) {
            return Err(invalid("Choose a separate backup file; the live database and its working files cannot be export destinations."));
        }
        let _gate = shared_gate(self.write_gate.as_ref())?;
        ensure_epoch(&self.conn, &self.data_epoch)?;
        write_snapshot(&self.conn, destination)
    }
    pub fn inspect_backup_file(&mut self, source: &Path) -> Result<BackupPreview> {
        self.ensure_available()?;
        self.prepared_backup = None;
        if reserved_path(self, source) {
            return Err(invalid("Choose an exported standalone backup, not the app's live database or working files."));
        }
        for suffix in ["-wal", "-journal"] {
            let mut side = source.as_os_str().to_os_string();
            side.push(suffix);
            if fs::metadata(side).is_ok_and(|m| m.len() > 0) {
                return Err(invalid("This database has live journal files. Export a standalone Silicon Quest backup before restoring it."));
            }
        }
        let input = File::open(source).map_err(io_error)?;
        let metadata = input.metadata().map_err(io_error)?;
        if !metadata.is_file() || metadata.len() > MAX_BACKUP_BYTES || metadata.len() < 100 {
            return Err(invalid(
                "Choose a standalone SQLite backup no larger than 2 GiB.",
            ));
        }
        let parent = self
            .database_path
            .as_ref()
            .and_then(|p| p.parent())
            .map(Path::to_path_buf)
            .unwrap_or_else(std::env::temp_dir);
        let directory = tempfile::Builder::new()
            .prefix(".silicon-restore-")
            .tempdir_in(parent)
            .map_err(io_error)?;
        let staged = directory.path().join("candidate.sqlite3");
        let mut output_options = File::options();
        output_options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            output_options.mode(0o600);
        }
        let mut output = output_options.open(&staged).map_err(io_error)?;
        let copied =
            std::io::copy(&mut input.take(MAX_BACKUP_BYTES + 1), &mut output).map_err(io_error)?;
        output.flush().map_err(io_error)?;
        drop(output);
        if copied > MAX_BACKUP_BYTES {
            return Err(invalid(
                "The backup grew beyond the supported 2 GiB limit while reading it.",
            ));
        }
        let (source_schema_version, created_at, interrupted_sessions) = validate(&staged)?;
        let candidate = Store::open(&staged)?;
        // Exercise domain deserialization after migrations while still isolated.
        candidate.dashboard()?;
        candidate.get_review_summary()?;
        candidate.get_focus_summary()?;
        candidate.get_project_summary()?;
        crate::projects::validate_integrity(&candidate.conn)?;
        validate(&staged)?;
        let preview_token: String =
            self.conn
                .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
        let preview = BackupPreview {
            preview_token,
            file_name: source
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            created_at,
            source_schema_version,
            current_schema_version: CURRENT_SCHEMA,
            bytes: copied,
            counts: counts(&candidate.conn)?,
            interrupted_sessions,
        };
        self.prepared_backup = Some(PreparedBackup {
            candidate: Box::new(candidate),
            _directory: directory,
            preview: preview.clone(),
            prepared_at: Instant::now(),
        });
        Ok(preview)
    }
    pub fn discard_backup_preview(&mut self, token: &str) -> Result<()> {
        self.ensure_available()?;
        if self
            .prepared_backup
            .as_ref()
            .is_some_and(|p| p.preview.preview_token == token)
        {
            self.prepared_backup = None;
        }
        Ok(())
    }
    pub fn restore_backup(&mut self, token: &str) -> Result<RestoreReport> {
        self.restore_backup_inner(token, None)
    }
    fn restore_backup_inner(
        &mut self,
        token: &str,
        fail_after_step: Option<usize>,
    ) -> Result<RestoreReport> {
        if let Some((committed, report)) = self.restore_result.as_ref() {
            if committed == token {
                return Ok(report.clone());
            }
        }
        self.ensure_available()?;
        if !self.focus.can_control() {
            return Err(error("focus_owned_elsewhere","Close the other Silicon Quest instance and restart this one before restoring a workspace."));
        }
        let prepared=self.prepared_backup.as_mut().filter(|p|p.preview.preview_token==token).ok_or_else(||invalid("Choose and inspect a backup before restoring. This preview is no longer available."))?;
        if prepared.prepared_at.elapsed() > PREVIEW_LIFETIME {
            return Err(invalid(
                "This restore preview expired. Choose the backup again to inspect it.",
            ));
        }
        // All cooperating app writers hold a shared gate. This exclusive gate spans
        // both safety capture and replacement, so accepted writes cannot fall between.
        let _gate = exclusive_gate(self.write_gate.as_ref())?;
        ensure_epoch(&self.conn, &self.data_epoch)?;
        let parent = self
            .database_path
            .as_ref()
            .and_then(|p| p.parent())
            .ok_or_else(|| invalid("Restore requires a persistent local workspace."))?;
        let recovery = parent.join("recovery");
        private_directory(&recovery)?;
        let recovery_id: String =
            self.conn
                .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
        let safety_name = format!("before-restore-{recovery_id}.sqlite3");
        let safety_path = recovery.join(&safety_name);
        write_snapshot(&self.conn, &safety_path)?;
        // Rotate BEFORE copying: even restoring this exact workspace's own backup
        // must invalidate all existing app connections immediately at commit.
        if let Err(failure) = prepared.candidate.conn.execute(
            "UPDATE app_metadata SET value=lower(hex(randomblob(16))) WHERE key='data_epoch'",
            [],
        ) {
            let mut failure = AppError::from(failure);
            failure
                .message
                .push_str(&format!(" Safety copy: {}", safety_path.display()));
            return Err(failure);
        }
        let report = RestoreReport {
            restored: true,
            restart_required: true,
            safety_backup_file_name: safety_name,
            safety_backup_path: safety_path.to_string_lossy().into_owned(),
            counts: prepared.preview.counts.clone(),
        };
        if let Err(mut failure) =
            online_copy(&prepared.candidate.conn, &mut self.conn, fail_after_step)
        {
            failure
                .message
                .push_str(&format!(" Safety copy: {}", safety_path.display()));
            return Err(failure);
        }
        // No fallible operation between committed replacement and the restart fence.
        self.restore_result = Some((token.into(), report.clone()));
        self.prepared_backup = None;
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const PDF: &[u8] = b"%PDF-1.7\nOriginal local fixture";
    fn open(root: &Path, name: &str) -> Store {
        Store::open(root.join(name)).unwrap()
    }
    fn populated(root: &Path) -> Store {
        let mut store = open(root, "live.sqlite3");
        store
            .conn
            .pragma_update(None, "wal_autocheckpoint", 0)
            .unwrap();
        store
            .save_note("cache-locality", "Backup observation")
            .unwrap();
        store.set_topic_status("cache-locality", "read").unwrap();
        store
            .submit_quiz("cache-locality", vec![2], "backup-attempt-01")
            .unwrap();
        let document = store.import_book_pdf("csapp", "my-book.pdf", PDF).unwrap();
        store
            .set_book_page("csapp", 5, &document.document_revision)
            .unwrap();
        store
            .add_bookmark("csapp", 5, "Keep this page", &document.document_revision)
            .unwrap();
        store
            .start_focus_session("cache-locality", "backup-focus-01")
            .unwrap();
        store
            .tick_focus_session("backup-focus-01", 1, true)
            .unwrap();
        store
            .conn
            .execute(
                "UPDATE focus_sessions SET elapsed_ms=12345 WHERE id='backup-focus-01'",
                [],
            )
            .unwrap();
        store
    }
    #[test]
    fn wal_snapshot_round_trip_contains_all_assets_and_preserves_queued_write_fence() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = populated(directory.path());
        let mut observer = open(directory.path(), "live.sqlite3");
        let old_epoch = store.data_epoch.clone();
        let wal = directory.path().join("live.sqlite3-wal");
        assert!(wal.metadata().unwrap().len() > 0);
        let file = directory.path().join("export.sqlite3");
        let exported = store.export_backup_file(&file).unwrap();
        assert!(exported.bytes > 100);
        assert!(!directory.path().join("export.sqlite3-wal").exists());
        store
            .save_note("cache-locality", "Newest current observation")
            .unwrap();
        let preview = store.inspect_backup_file(&file).unwrap();
        assert_eq!(preview.source_schema_version, CURRENT_SCHEMA);
        assert_eq!(preview.counts.pdfs, 1);
        assert_eq!(preview.counts.total_xp, 120);
        assert_eq!(preview.counts.attempts, 1);
        assert_eq!(preview.counts.tracked_seconds, 12);
        let report = store.restore_backup(&preview.preview_token).unwrap();
        assert!(report.restart_required);
        assert!(Path::new(&report.safety_backup_path).exists());
        assert_eq!(
            store.ensure_available().unwrap_err().code,
            "restart_required"
        );
        assert_eq!(
            observer
                .save_note("cache-locality", "stale note")
                .unwrap_err()
                .code,
            "workspace_replaced"
        );
        assert_eq!(
            store
                .save_note("cache-locality", "queued old note")
                .unwrap_err()
                .code,
            "restart_required"
        );
        assert_eq!(
            store
                .submit_quiz("cache-locality", vec![2], "queued-old-quiz")
                .unwrap_err()
                .code,
            "restart_required"
        );
        assert_eq!(
            store
                .tick_focus_session("backup-focus-01", 2, true)
                .unwrap_err()
                .code,
            "restart_required"
        );
        assert_eq!(
            store
                .import_book_pdf("csapp", "queued.pdf", PDF)
                .unwrap_err()
                .code,
            "restart_required"
        );
        let replay = store.restore_backup(&preview.preview_token).unwrap();
        assert_eq!(replay.safety_backup_path, report.safety_backup_path);
        assert_eq!(
            fs::read_dir(directory.path().join("recovery"))
                .unwrap()
                .count(),
            1
        );
        let status = store.backup_status().unwrap();
        assert!(status.restart_required);
        assert_eq!(
            status.safety_backup_path.as_deref(),
            Some(report.safety_backup_path.as_str())
        );
        assert!(observer.backup_status().unwrap().workspace_replaced);
        let safety = Connection::open_with_flags(
            &report.safety_backup_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        assert_eq!(
            safety
                .query_row("SELECT body FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Newest current observation"
        );
        drop(safety);
        drop(observer);
        drop(store);
        let restored = open(directory.path(), "live.sqlite3");
        assert_ne!(restored.data_epoch, old_epoch);
        assert_eq!(
            restored.dashboard().unwrap().notes[0].body,
            "Backup observation"
        );
        assert_eq!(restored.dashboard().unwrap().total_xp, 120);
        assert_eq!(restored.get_book_pdf("csapp").unwrap(), PDF);
        let reader = restored.get_book_reader_state("csapp").unwrap();
        assert_eq!(reader.page, 5);
        assert_eq!(reader.bookmarks[0].label, "Keep this page");
        assert_eq!(restored.get_focus_summary().unwrap().total_seconds, 12);
        assert_eq!(restored.get_review_summary().unwrap().total_scheduled, 1);
    }
    #[test]
    fn preview_uses_private_staged_copy_and_replacing_or_discarding_invalidates_tokens() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = populated(directory.path());
        let file = directory.path().join("export.sqlite3");
        store.export_backup_file(&file).unwrap();
        let first = store.inspect_backup_file(&file).unwrap();
        let staged = store
            .prepared_backup
            .as_ref()
            .unwrap()
            ._directory
            .path()
            .to_path_buf();
        let second = store.inspect_backup_file(&file).unwrap();
        assert_ne!(first.preview_token, second.preview_token);
        assert!(!staged.exists());
        assert!(store.restore_backup(&first.preview_token).is_err());
        fs::write(&file, b"source path changed after inspection").unwrap();
        store.save_note("cache-locality", "Current data").unwrap();
        store.restore_backup(&second.preview_token).unwrap();
        drop(store);
        let restored = open(directory.path(), "live.sqlite3");
        assert_eq!(
            restored.dashboard().unwrap().notes[0].body,
            "Backup observation"
        );
    }
    #[test]
    fn expired_and_discarded_previews_never_mutate_workspace() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = populated(directory.path());
        let file = directory.path().join("export.sqlite3");
        store.export_backup_file(&file).unwrap();
        let preview = store.inspect_backup_file(&file).unwrap();
        store.prepared_backup.as_mut().unwrap().prepared_at =
            Instant::now() - Duration::from_secs(901);
        assert!(store.restore_backup(&preview.preview_token).is_err());
        assert!(!directory.path().join("recovery").exists());
        store
            .discard_backup_preview(&preview.preview_token)
            .unwrap();
        assert!(store.prepared_backup.is_none());
        assert!(store.restore_backup(&preview.preview_token).is_err());
        assert!(store.ensure_available().is_ok());
    }
    #[test]
    fn unfinished_restore_copy_rolls_back_and_retains_safety_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = populated(directory.path());
        let file = directory.path().join("export.sqlite3");
        store.export_backup_file(&file).unwrap();
        let preview = store.inspect_backup_file(&file).unwrap();
        store
            .save_note("cache-locality", "Keep this on failed restore")
            .unwrap();
        let epoch = store.data_epoch.clone();
        let failed = store
            .restore_backup_inner(&preview.preview_token, Some(1))
            .unwrap_err();
        assert_eq!(failed.code, "backup_interrupted");
        assert!(store.ensure_available().is_ok());
        assert_eq!(read_epoch(&store.conn).unwrap(), epoch);
        assert!(store.restore_result.is_none());
        assert_eq!(
            store.dashboard().unwrap().notes[0].body,
            "Keep this on failed restore"
        );
        let backups = fs::read_dir(directory.path().join("recovery"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1);
        assert!(validate(&backups[0]).is_ok());
        let safety = Connection::open(&backups[0]).unwrap();
        assert_eq!(
            safety
                .query_row("SELECT body FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Keep this on failed restore"
        );
        drop(safety);
        store
            .save_note("cache-locality", "Still writable after rollback")
            .unwrap();
        store.restore_backup(&preview.preview_token).unwrap();
    }
    #[test]
    fn exclusive_gate_blocks_new_instances_and_old_writers_before_safety_capture() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = populated(directory.path());
        let mut observer = open(directory.path(), "live.sqlite3");
        let path = directory.path().join("live.sqlite3");
        let gate = open_gate(&path).unwrap();
        let held = exclusive_gate(Some(&gate)).unwrap();
        assert_eq!(
            observer
                .save_note("cache-locality", "Must not be accepted")
                .unwrap_err()
                .code,
            "backup_busy"
        );
        let blocked = Store::open(&path);
        assert!(matches!(
            blocked,
            Err(AppError {
                code: "backup_busy",
                ..
            })
        ));
        drop(held);
        let file = directory.path().join("export.sqlite3");
        store.export_backup_file(&file).unwrap();
        let preview = store.inspect_backup_file(&file).unwrap();
        let held = shared_gate(observer.write_gate.as_ref()).unwrap();
        assert_eq!(
            store
                .restore_backup(&preview.preview_token)
                .unwrap_err()
                .code,
            "backup_busy"
        );
        assert!(!directory.path().join("recovery").exists());
        drop(held);
        observer
            .save_note("cache-locality", "Accepted before restore gate")
            .unwrap();
        let report = store.restore_backup(&preview.preview_token).unwrap();
        let safety = Connection::open(&report.safety_backup_path).unwrap();
        assert_eq!(
            safety
                .query_row("SELECT body FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Accepted before restore gate"
        );
        assert_eq!(
            observer
                .save_note("cache-locality", "After restore")
                .unwrap_err()
                .code,
            "workspace_replaced"
        );
    }
    #[test]
    fn active_focus_export_is_checkpoint_only_and_restore_interrupts_it() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = populated(directory.path());
        store
            .start_focus_session("cache-locality", "active-backup-focus")
            .unwrap();
        let file = directory.path().join("active.sqlite3");
        store.export_backup_file(&file).unwrap();
        let preview = store.inspect_backup_file(&file).unwrap();
        assert_eq!(preview.interrupted_sessions, 1);
        assert!(store.get_focus_summary().unwrap().active_session.is_some());
        store.restore_backup(&preview.preview_token).unwrap();
        drop(store);
        let restored = open(directory.path(), "live.sqlite3");
        let focus = restored.get_focus_summary().unwrap();
        assert!(focus.active_session.is_none());
        assert_eq!(focus.interrupted_sessions, 1);
        assert_eq!(focus.total_seconds, 12);
    }
    #[test]
    fn another_instances_non_owner_cannot_restore_or_overwrite_live_paths() {
        let directory = tempfile::tempdir().unwrap();
        let store = populated(directory.path());
        let mut observer = open(directory.path(), "live.sqlite3");
        let file = directory.path().join("export.sqlite3");
        store.export_backup_file(&file).unwrap();
        let preview = observer.inspect_backup_file(&file).unwrap();
        assert_eq!(
            observer
                .restore_backup(&preview.preview_token)
                .unwrap_err()
                .code,
            "focus_owned_elsewhere"
        );
        assert!(store
            .export_backup_file(&directory.path().join("live.sqlite3"))
            .is_err());
        assert!(observer
            .inspect_backup_file(&directory.path().join("live.sqlite3"))
            .is_err());
        assert!(store
            .export_backup_file(&directory.path().join("live.sqlite3-wal"))
            .is_err());
        #[cfg(unix)]
        {
            let alias = directory.path().join("alias.sqlite3");
            std::os::unix::fs::symlink(directory.path().join("live.sqlite3"), &alias).unwrap();
            assert!(store.export_backup_file(&alias).is_err());
            assert!(observer.inspect_backup_file(&alias).is_err());
        }
    }
    #[test]
    fn legacy_schema_one_is_migrated_only_in_staging_and_restores_with_assets() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = directory.path().join("legacy.sqlite3");
        {
            let conn = reference_schema(1).unwrap();
            let mut disk = Connection::open(&legacy).unwrap();
            online_copy(&conn, &mut disk, None).unwrap();
            disk.pragma_update(None, "user_version", 1).unwrap();
            disk.execute(
                "INSERT INTO books(id,title,metadata_json) VALUES('csapp','Old book','{}')",
                [],
            )
            .unwrap();
            disk.execute("INSERT INTO topics(id,book_id,title,metadata_json) VALUES('cache-locality','csapp','Caches','{}')",[]).unwrap();
            disk.execute(
                "INSERT INTO topic_progress(topic_id,status) VALUES('cache-locality','read')",
                [],
            )
            .unwrap();
            disk.execute("INSERT INTO notes(topic_id,body,updated_at) VALUES('cache-locality','Legacy note','2026-11-10T10:00:00Z')",[]).unwrap();
            disk.execute("INSERT INTO book_documents(book_id,file_name,imported_at,bytes) VALUES('csapp','old.pdf','2026-11-10T10:00:00Z',?1)",[PDF]).unwrap();
        }
        let mut store = open(directory.path(), "live.sqlite3");
        let preview = store.inspect_backup_file(&legacy).unwrap();
        assert_eq!(preview.source_schema_version, 1);
        assert_eq!(preview.current_schema_version, CURRENT_SCHEMA);
        assert_eq!(preview.counts.pdfs, 1);
        assert!(preview.created_at.is_none());
        let source =
            Connection::open_with_flags(&legacy, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let version: i64 = source
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 1);
        drop(source);
        store.restore_backup(&preview.preview_token).unwrap();
        drop(store);
        let restored = open(directory.path(), "live.sqlite3");
        assert_eq!(restored.dashboard().unwrap().notes[0].body, "Legacy note");
        assert_eq!(restored.get_book_pdf("csapp").unwrap(), PDF);
    }
    #[test]
    fn every_supported_schema_revision_migrates_in_staging_without_source_mutation() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = open(directory.path(), "live.sqlite3");
        for version in 1..=CURRENT_SCHEMA {
            let path = directory.path().join(format!("schema-{version}.sqlite3"));
            {
                let reference = reference_schema(version).unwrap();
                let mut disk = Connection::open(&path).unwrap();
                online_copy(&reference, &mut disk, None).unwrap();
                disk.pragma_update(None, "user_version", version).unwrap();
            }
            let preview = store.inspect_backup_file(&path).unwrap();
            assert_eq!(preview.source_schema_version, version);
            assert_eq!(preview.current_schema_version, CURRENT_SCHEMA);
            assert_eq!(preview.counts.topics, 24);
            let original =
                Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
            assert_eq!(
                original
                    .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                    .unwrap(),
                version
            );
            store
                .discard_backup_preview(&preview.preview_token)
                .unwrap();
        }
        assert_eq!(store.dashboard().unwrap().total_xp, 0);
    }
    #[test]
    fn project_evidence_review_history_and_xp_round_trip_and_restore_fences_project_writes() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = populated(directory.path());
        let milestone = "p1-order-contract";
        let state = store
            .get_project_summary()
            .unwrap()
            .milestones
            .into_iter()
            .find(|m| m.milestone_id == milestone)
            .unwrap();
        let checks = state
            .task_checks
            .into_iter()
            .map(|mut t| {
                t.done = true;
                t
            })
            .collect::<Vec<_>>();
        let evidence="Recorded correctness commands and outputs at ./reports/engine-tests.txt for explicit self-review.";
        let rationale="I reviewed all recorded task evidence against the definition of done and documented the remaining limits.";
        store
            .save_project_milestone(
                milestone,
                checks.clone(),
                evidence,
                "ready_for_review",
                0,
                "backup-project-save",
            )
            .unwrap();
        store
            .review_project_milestone(milestone, rationale, true, 1, "backup-project-review")
            .unwrap();
        let file = directory.path().join("projects.sqlite3");
        store.export_backup_file(&file).unwrap();
        store
            .reopen_project_milestone(
                milestone,
                "Recheck after changing test inputs",
                2,
                "backup-project-reopen",
            )
            .unwrap();
        let preview = store.inspect_backup_file(&file).unwrap();
        assert_eq!(preview.counts.project_milestones, 35);
        assert_eq!(preview.counts.reviewed_milestones, 1);
        assert_eq!(preview.counts.project_evidence_notes, 1);
        assert_eq!(preview.counts.total_xp, 170);
        let mut observer = open(directory.path(), "live.sqlite3");
        store.restore_backup(&preview.preview_token).unwrap();
        assert_eq!(
            store
                .save_project_milestone(
                    milestone,
                    checks.clone(),
                    evidence,
                    "in_progress",
                    3,
                    "queued-project-save"
                )
                .unwrap_err()
                .code,
            "restart_required"
        );
        assert_eq!(
            observer
                .save_project_milestone(
                    milestone,
                    checks,
                    evidence,
                    "in_progress",
                    3,
                    "stale-project-save"
                )
                .unwrap_err()
                .code,
            "workspace_replaced"
        );
        drop(observer);
        drop(store);
        let restored = open(directory.path(), "live.sqlite3");
        let projects = restored.get_project_summary().unwrap();
        let state = projects
            .milestones
            .iter()
            .find(|m| m.milestone_id == milestone)
            .unwrap();
        assert_eq!(state.status, "completed");
        assert_eq!(state.evidence_note, evidence);
        assert_eq!(state.review_note.as_deref(), Some(rationale));
        assert_eq!(projects.total_xp_earned, 50);
        assert_eq!(projects.history.len(), 2);
        assert_eq!(restored.dashboard().unwrap().total_xp, 170);
    }
    #[test]
    fn inconsistent_project_completions_and_reassigned_tasks_are_rejected_without_live_changes() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = populated(directory.path());
        let file = directory.path().join("projects-invalid.sqlite3");
        store.export_backup_file(&file).unwrap();
        {
            let conn = Connection::open(&file).unwrap();
            conn.execute("UPDATE project_milestone_state SET status='completed' WHERE milestone_id='p1-order-contract'",[]).unwrap();
        }
        assert!(store.inspect_backup_file(&file).is_err());
        store.export_backup_file(&file).unwrap();
        {
            let conn = Connection::open(&file).unwrap();
            conn.execute("UPDATE project_tasks SET milestone_id='p1-replay' WHERE id=(SELECT id FROM project_tasks WHERE milestone_id='p1-order-contract' LIMIT 1)",[]).unwrap();
        }
        assert!(store.inspect_backup_file(&file).is_err());
        assert_eq!(
            store
                .get_project_summary()
                .unwrap()
                .completed_required_milestones,
            0
        );
        assert_eq!(store.dashboard().unwrap().total_xp, 120);
    }
    #[test]
    fn unsupported_corrupt_and_unexpected_schema_backups_are_rejected_before_live_changes() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = populated(directory.path());
        let file = directory.path().join("export.sqlite3");
        fs::write(&file, b"Not a SQLite database").unwrap();
        assert!(store.inspect_backup_file(&file).is_err());
        store.export_backup_file(&file).unwrap();
        File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_len(512)
            .unwrap();
        assert!(store.inspect_backup_file(&file).is_err());
        store.export_backup_file(&file).unwrap();
        {
            let conn = Connection::open(&file).unwrap();
            conn.pragma_update(None, "user_version", 999).unwrap();
        }
        assert!(store.inspect_backup_file(&file).is_err());
        store.export_backup_file(&file).unwrap();
        {
            let conn = Connection::open(&file).unwrap();
            conn.pragma_update(None, "application_id", 42).unwrap();
        }
        assert!(store.inspect_backup_file(&file).is_err());
        store.export_backup_file(&file).unwrap();
        {
            let conn = Connection::open(&file).unwrap();
            conn.execute_batch("CREATE TRIGGER extra_trigger AFTER INSERT ON notes BEGIN DELETE FROM xp_ledger; END;").unwrap();
        }
        assert!(store.inspect_backup_file(&file).is_err());
        store.export_backup_file(&file).unwrap();
        {
            let conn = Connection::open(&file).unwrap();
            conn.execute_batch("CREATE VIEW extra_view AS SELECT * FROM notes;")
                .unwrap();
        }
        assert!(store.inspect_backup_file(&file).is_err());
        store.export_backup_file(&file).unwrap();
        {
            let conn = Connection::open(&file).unwrap();
            conn.execute_batch(
                "CREATE TRIGGER sqliteXwipe AFTER UPDATE ON books BEGIN DELETE FROM notes; END;",
            )
            .unwrap();
        }
        assert!(store.inspect_backup_file(&file).is_err());
        store.export_backup_file(&file).unwrap();
        {
            let conn = Connection::open(&file).unwrap();
            conn.execute_batch("CREATE VIEW sqliteXsecret AS SELECT * FROM notes;")
                .unwrap();
        }
        assert!(store.inspect_backup_file(&file).is_err());
        assert!(store.ensure_available().is_ok());
        assert_eq!(store.dashboard().unwrap().total_xp, 120);
        assert!(!directory.path().join("recovery").exists());
    }
    #[test]
    fn broken_references_invalid_pdf_and_hot_or_oversized_files_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = populated(directory.path());
        let file = directory.path().join("export.sqlite3");
        store.export_backup_file(&file).unwrap();
        {
            let conn = Connection::open(&file).unwrap();
            conn.pragma_update(None, "foreign_keys", false).unwrap();
            conn.execute("INSERT INTO notes(topic_id,body,updated_at) VALUES('not-a-topic','bad reference','2026-11-10T10:00:00Z')",[]).unwrap();
        }
        assert!(store.inspect_backup_file(&file).is_err());
        store.export_backup_file(&file).unwrap();
        {
            let conn = Connection::open(&file).unwrap();
            conn.execute("UPDATE book_documents SET bytes=x'6e6f74206120706466'", [])
                .unwrap();
        }
        assert!(store.inspect_backup_file(&file).is_err());
        store.export_backup_file(&file).unwrap();
        {
            let conn = Connection::open(&file).unwrap();
            conn.execute("INSERT INTO books(id,title,metadata_json) VALUES('unknown-future-book','Unsupported','{}')",[]).unwrap();
        }
        assert!(store.inspect_backup_file(&file).is_err());
        store.export_backup_file(&file).unwrap();
        let mut wal = file.as_os_str().to_os_string();
        wal.push("-wal");
        fs::write(&wal, b"hot journal marker").unwrap();
        assert!(store.inspect_backup_file(&file).is_err());
        fs::remove_file(wal).unwrap();
        let huge = directory.path().join("huge.sqlite3");
        File::create(&huge)
            .unwrap()
            .set_len(MAX_BACKUP_BYTES + 1)
            .unwrap();
        assert!(store.inspect_backup_file(&huge).is_err());
        assert!(store.ensure_available().is_ok());
    }
}
