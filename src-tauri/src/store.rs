use chrono::{Duration, Local, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

const CURRICULUM: &str = include_str!("../../curriculum/data.json");
const MAX_PDF_BYTES: usize = 100 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, AppError>;
fn invalid(message: &str) -> AppError {
    AppError {
        code: "invalid_input",
        message: message.into(),
    }
}
impl From<rusqlite::Error> for AppError {
    fn from(_: rusqlite::Error) -> Self {
        Self { code: "storage_error", message: "The local database operation failed. Your existing progress was preserved; try again or restart the app.".into() }
    }
}
impl From<serde_json::Error> for AppError {
    fn from(_: serde_json::Error) -> Self {
        Self {
            code: "data_error",
            message: "Local curriculum or saved data could not be read.".into(),
        }
    }
}
fn now() -> String {
    Utc::now().to_rfc3339()
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicProgress {
    pub topic_id: String,
    pub status: String,
    pub mastery: String,
    pub best_score: Option<i64>,
    pub last_studied_at: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    pub id: String,
    pub title: String,
    pub earned_at: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizAttempt {
    pub attempt_id: String,
    pub topic_id: String,
    pub score: i64,
    pub total: i64,
    pub passed: bool,
    pub xp_awarded: i64,
    pub created_at: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub topic_id: String,
    pub body: String,
    pub updated_at: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub topics: Vec<TopicProgress>,
    pub total_xp: i64,
    pub level: i64,
    pub achievements: Vec<Achievement>,
    pub attempts: Vec<QuizAttempt>,
    pub notes: Vec<Note>,
    pub streak_days: i64,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Feedback {
    pub question_id: String,
    pub correct: bool,
    pub correct_index: usize,
    pub explanation: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizResult {
    pub attempt: QuizAttempt,
    pub feedback: Vec<Feedback>,
    pub dashboard: Dashboard,
    pub review_update: crate::review::ReviewEvent,
    pub review_summary: crate::review::ReviewSummary,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDocument {
    pub book_id: String,
    pub file_name: String,
    pub imported_at: String,
    pub document_revision: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageBookmark {
    pub id: String,
    pub page: i64,
    pub label: String,
    pub created_at: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookReaderState {
    pub page: i64,
    pub document_revision: Option<String>,
    pub bookmarks: Vec<PageBookmark>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quiz {
    pub topic_id: String,
    pub questions: Vec<PublicQuestion>,
}
#[derive(Debug, Serialize)]
pub struct PublicQuestion {
    pub id: String,
    pub prompt: String,
    pub options: Vec<String>,
}

pub struct Store {
    pub(crate) conn: Connection,
    curriculum: Value,
    pub(crate) focus: crate::focus::FocusRuntime,
    pub(crate) data_epoch: String,
    pub(crate) write_gate: Option<std::fs::File>,
    pub(crate) database_path: Option<std::path::PathBuf>,
    pub(crate) prepared_backup: Option<crate::backup::PreparedBackup>,
    pub(crate) restore_result: Option<(String, crate::backup::RestoreReport)>,
}
impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let conn = Connection::open(path)?;
        let canonical = path
            .canonicalize()
            .map_err(|_| invalid("Could not locate local storage."))?;
        let gate = crate::backup::open_gate(&canonical)?;
        // Startup seeds/migrations are writes too: a newly opened process must
        // not slip between the restore safety snapshot and replacement.
        let startup_guard = crate::backup::shared_gate(Some(&gate))?;
        let (lock, owner) = crate::focus::FocusRuntime::lock(path)?;
        let mut store = Self::initialize_with_focus(conn, lock, owner)?;
        drop(startup_guard);
        store.write_gate = Some(gate);
        store.database_path = Some(canonical);
        Ok(store)
    }

    #[cfg(test)]
    pub(crate) fn initialize(conn: Connection) -> Result<Self> {
        Self::initialize_with_focus(conn, None, true)
    }
    fn initialize_with_focus(
        mut conn: Connection,
        lock: Option<std::fs::File>,
        owner: bool,
    ) -> Result<Self> {
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > 6 {
            return Err(AppError { code: "newer_database", message: "This database was created by a newer Silicon Quest version. Update the app to open it.".into() });
        }
        if version < 1 {
            let tx = conn.transaction()?;
            tx.execute_batch(include_str!("../migrations/001_initial.sql"))?;
            tx.pragma_update(None, "user_version", 1)?;
            tx.commit()?;
        }
        if version < 2 {
            let tx = conn.transaction()?;
            tx.execute_batch(include_str!("../migrations/002_reader_state.sql"))?;
            tx.pragma_update(None, "user_version", 2)?;
            tx.commit()?;
        }
        if version < 3 {
            let tx = conn.transaction()?;
            tx.execute_batch(include_str!("../migrations/003_focus_sessions.sql"))?;
            tx.pragma_update(None, "user_version", 3)?;
            tx.commit()?;
        }
        if version < 4 {
            let tx = conn.transaction()?;
            tx.execute_batch(include_str!("../migrations/004_spaced_review.sql"))?;
            crate::review::backfill(&tx)?;
            tx.pragma_update(None, "user_version", 4)?;
            tx.commit()?;
        }
        if version < 5 {
            let tx = conn.transaction()?;
            tx.execute_batch(include_str!("../migrations/005_backup_identity.sql"))?;
            tx.pragma_update(None, "user_version", 5)?;
            tx.commit()?;
        }
        if version < 6 {
            let tx = conn.transaction()?;
            tx.execute_batch(include_str!("../migrations/006_project_tracking.sql"))?;
            tx.pragma_update(None, "user_version", 6)?;
            tx.commit()?;
        }
        let curriculum: Value = serde_json::from_str(CURRICULUM)?;
        let tx = conn.transaction()?;
        for book in curriculum["books"]
            .as_array()
            .ok_or_else(|| invalid("Invalid bundled books."))?
        {
            tx.execute("INSERT INTO books(id,title,metadata_json) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET title=excluded.title,metadata_json=excluded.metadata_json", params![string(book,"id")?, string(book,"title")?, serde_json::to_string(book)?])?;
        }
        for topic in curriculum["modules"]
            .as_array()
            .ok_or_else(|| invalid("Invalid bundled modules."))?
        {
            tx.execute("INSERT INTO topics(id,book_id,title,metadata_json) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET title=excluded.title,metadata_json=excluded.metadata_json", params![string(topic,"id")?,topic["bookId"].as_str(),string(topic,"title")?,serde_json::to_string(topic)?])?;
            tx.execute(
                "INSERT OR IGNORE INTO topic_progress(topic_id) VALUES(?1)",
                [string(topic, "id")?],
            )?;
        }
        crate::projects::seed(&tx, &curriculum)?;
        tx.commit()?;
        let focus = crate::focus::FocusRuntime::initialize(&conn, lock, owner)?;
        let data_epoch = crate::backup::read_epoch(&conn)?;
        Ok(Self {
            conn,
            curriculum,
            focus,
            data_epoch,
            write_gate: None,
            database_path: None,
            prepared_backup: None,
            restore_result: None,
        })
    }
    pub fn ensure_available(&self) -> Result<()> {
        if self.restore_result.is_some() {
            return Err(crate::backup::error(
                "restart_required",
                "Restore is complete. Restart Silicon Quest before using the restored workspace.",
            ));
        }
        crate::backup::ensure_epoch(&self.conn, &self.data_epoch)
    }
    pub fn get_project_summary(&self) -> Result<crate::projects::ProjectSummary> {
        crate::projects::summary(&self.conn)
    }
    fn project_result(
        &self,
        effect: crate::projects::Effect,
    ) -> Result<crate::projects::ProjectMutationResult> {
        Ok(crate::projects::ProjectMutationResult {
            summary: self.get_project_summary()?,
            dashboard: self.dashboard()?,
            milestone_id: effect.milestone_id,
            xp_awarded: effect.xp_awarded,
            replayed: effect.replayed,
        })
    }
    pub fn save_project_milestone(
        &mut self,
        id: &str,
        checks: Vec<crate::projects::TaskCheck>,
        evidence: &str,
        status: &str,
        expected: i64,
        request: &str,
    ) -> Result<crate::projects::ProjectMutationResult> {
        self.ensure_available()?;
        let _gate = crate::backup::shared_gate(self.write_gate.as_ref())?;
        let effect = crate::projects::save(
            &mut self.conn,
            &self.data_epoch,
            id,
            checks,
            evidence,
            status,
            expected,
            request,
        )?;
        self.project_result(effect)
    }
    pub fn review_project_milestone(
        &mut self,
        id: &str,
        note: &str,
        confirmed: bool,
        expected: i64,
        request: &str,
    ) -> Result<crate::projects::ProjectMutationResult> {
        self.ensure_available()?;
        let _gate = crate::backup::shared_gate(self.write_gate.as_ref())?;
        let effect = crate::projects::review(
            &mut self.conn,
            &self.data_epoch,
            id,
            note,
            confirmed,
            expected,
            request,
        )?;
        self.project_result(effect)
    }
    pub fn reopen_project_milestone(
        &mut self,
        id: &str,
        reason: &str,
        expected: i64,
        request: &str,
    ) -> Result<crate::projects::ProjectMutationResult> {
        self.ensure_available()?;
        let _gate = crate::backup::shared_gate(self.write_gate.as_ref())?;
        let effect = crate::projects::reopen(
            &mut self.conn,
            &self.data_epoch,
            id,
            reason,
            expected,
            request,
        )?;
        self.project_result(effect)
    }
    pub fn get_review_summary(&self) -> Result<crate::review::ReviewSummary> {
        crate::review::summary(&self.conn)
    }
    pub fn get_focus_summary(&self) -> Result<crate::focus::FocusSummary> {
        crate::focus::summary(&self.conn, &self.focus)
    }
    pub fn start_focus_session(
        &mut self,
        topic_id: &str,
        request_id: &str,
    ) -> Result<crate::focus::FocusSummary> {
        self.ensure_available()?;
        let _write_guard = crate::backup::shared_gate(self.write_gate.as_ref())?;
        self.require_topic(topic_id)?;
        crate::focus::start(&mut self.conn, &mut self.focus, topic_id, request_id)
    }
    pub fn tick_focus_session(
        &mut self,
        session_id: &str,
        sequence: i64,
        end: bool,
    ) -> Result<crate::focus::FocusSummary> {
        self.ensure_available()?;
        let _write_guard = crate::backup::shared_gate(self.write_gate.as_ref())?;
        crate::focus::tick(&mut self.conn, &mut self.focus, session_id, sequence, end)
    }
    pub fn dashboard(&self) -> Result<Dashboard> {
        let topics = self.conn.prepare("SELECT topic_id,status,mastery,best_score,last_studied_at FROM topic_progress ORDER BY rowid")?.query_map([], |r| Ok(TopicProgress { topic_id:r.get(0)?,status:r.get(1)?,mastery:r.get(2)?,best_score:r.get(3)?,last_studied_at:r.get(4)? }))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let total_xp: i64 =
            self.conn
                .query_row("SELECT COALESCE(SUM(amount),0) FROM xp_ledger", [], |r| {
                    r.get(0)
                })?;
        let achievements = self
            .conn
            .prepare("SELECT id,title,earned_at FROM achievements ORDER BY earned_at")?
            .query_map([], |r| {
                Ok(Achievement {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    earned_at: r.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let attempts = self.conn.prepare("SELECT attempt_id,topic_id,score,total,passed,xp_awarded,created_at FROM quiz_attempts ORDER BY created_at DESC, rowid DESC LIMIT 100")?.query_map([], attempt_from_row)?.collect::<std::result::Result<Vec<_>,_>>()?;
        let notes = self
            .conn
            .prepare("SELECT topic_id,body,updated_at FROM notes ORDER BY updated_at DESC")?
            .query_map([], |r| {
                Ok(Note {
                    topic_id: r.get(0)?,
                    body: r.get(1)?,
                    updated_at: r.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let days = self
            .conn
            .prepare("SELECT day FROM activity_days ORDER BY day DESC")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Dashboard {
            topics,
            total_xp,
            level: 1 + total_xp / 250,
            achievements,
            attempts,
            notes,
            streak_days: streak(&days, Local::now().date_naive()),
        })
    }
    fn require_topic(&self, id: &str) -> Result<()> {
        if self
            .conn
            .query_row("SELECT 1 FROM topics WHERE id=?1", [id], |_| Ok(()))
            .optional()?
            .is_none()
        {
            return Err(invalid("Unknown learning topic."));
        }
        Ok(())
    }
    fn require_book(&self, id: &str) -> Result<()> {
        if self
            .conn
            .query_row("SELECT 1 FROM books WHERE id=?1", [id], |_| Ok(()))
            .optional()?
            .is_none()
        {
            return Err(invalid("Unknown book."));
        }
        Ok(())
    }
    pub fn set_topic_status(&mut self, topic_id: &str, status: &str) -> Result<Dashboard> {
        self.ensure_available()?;
        let _write_guard = crate::backup::shared_gate(self.write_gate.as_ref())?;
        self.require_topic(topic_id)?;
        if !["not_started", "reading", "read"].contains(&status) {
            return Err(invalid("Unknown reading status."));
        }
        let timestamp = now();
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        crate::backup::ensure_epoch(&tx, &self.data_epoch)?;
        let changed=tx.execute("UPDATE topic_progress SET status=?2,last_studied_at=?3 WHERE topic_id=?1 AND status<>?2",params![topic_id,status,timestamp])?;
        if changed > 0 {
            if status == "read" {
                award(&tx, &format!("read:{topic_id}"), 20, &timestamp)?;
                tx.execute("INSERT OR IGNORE INTO achievements(id,title,earned_at) VALUES('first-steps','First Steps',?1)",[&timestamp])?;
            }
            activity(&tx)?;
        }
        tx.commit()?;
        self.dashboard()
    }
    pub fn save_note(&mut self, topic_id: &str, body: &str) -> Result<Dashboard> {
        self.ensure_available()?;
        let _write_guard = crate::backup::shared_gate(self.write_gate.as_ref())?;
        self.require_topic(topic_id)?;
        if body.len() > 100_000 {
            return Err(invalid("Notes must be under 100,000 bytes."));
        }
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        crate::backup::ensure_epoch(&tx, &self.data_epoch)?;
        tx.execute("INSERT INTO notes(topic_id,body,updated_at) VALUES(?1,?2,?3) ON CONFLICT(topic_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",params![topic_id,body,now()])?;
        activity(&tx)?;
        tx.commit()?;
        self.dashboard()
    }
    fn questions(&self, topic_id: &str) -> Result<Vec<&Value>> {
        self.require_topic(topic_id)?;
        Ok(self.curriculum["quizQuestions"]
            .as_array()
            .ok_or_else(|| invalid("Invalid bundled quiz."))?
            .iter()
            .filter(|q| q["moduleId"].as_str() == Some(topic_id))
            .collect())
    }
    pub fn get_quiz(&self, topic_id: &str) -> Result<Quiz> {
        let questions = self
            .questions(topic_id)?
            .iter()
            .map(|q| {
                Ok(PublicQuestion {
                    id: string(q, "id")?.into(),
                    prompt: string(q, "prompt")?.into(),
                    options: serde_json::from_value(q["choices"].clone())?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Quiz {
            topic_id: topic_id.into(),
            questions,
        })
    }
    pub fn submit_quiz(
        &mut self,
        topic_id: &str,
        answers: Vec<usize>,
        attempt_id: &str,
    ) -> Result<QuizResult> {
        self.ensure_available()?;
        let _write_guard = crate::backup::shared_gate(self.write_gate.as_ref())?;
        if attempt_id.len() < 8
            || attempt_id.len() > 128
            || !attempt_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(invalid(
                "Use a unique attempt ID of 8–128 letters, digits, hyphens or underscores.",
            ));
        }
        let answers_json = serde_json::to_string(&answers)?;
        let existing = self
            .conn
            .query_row(
                "SELECT topic_id,answers_json,feedback_json FROM quiz_attempts WHERE attempt_id=?1",
                [attempt_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        if let Some((old_topic, old_answers, feedback)) = existing {
            if old_topic != topic_id || old_answers != answers_json {
                return Err(invalid(
                    "This attempt ID was already used with different answers.",
                ));
            }
            let attempt=self.conn.query_row("SELECT attempt_id,topic_id,score,total,passed,xp_awarded,created_at FROM quiz_attempts WHERE attempt_id=?1",[attempt_id],attempt_from_row)?;
            return Ok(QuizResult {
                attempt,
                feedback: serde_json::from_str(&feedback)?,
                dashboard: self.dashboard()?,
                review_update: crate::review::event(&self.conn, attempt_id)?,
                review_summary: self.get_review_summary()?,
            });
        }
        let questions = self.questions(topic_id)?;
        if questions.is_empty() {
            return Err(invalid("This topic has no quiz yet."));
        }
        if answers.len() != questions.len() {
            return Err(invalid("Answer every quiz question before submitting."));
        }
        let mut feedback = Vec::new();
        for (question, answer) in questions.iter().zip(answers.iter()) {
            let options = question["choices"]
                .as_array()
                .ok_or_else(|| invalid("Invalid bundled quiz options."))?;
            if *answer >= options.len() {
                return Err(invalid(
                    "A selected answer is outside the available options.",
                ));
            }
            let correct_index = question["correctIndex"]
                .as_u64()
                .ok_or_else(|| invalid("Invalid bundled answer key."))?
                as usize;
            feedback.push(Feedback {
                question_id: string(question, "id")?.into(),
                correct: *answer == correct_index,
                correct_index,
                explanation: string(question, "explanation")?.into(),
            });
        }
        let total = feedback.len() as i64;
        let score = feedback.iter().filter(|f| f.correct).count() as i64;
        let passed = score * 100 >= total * 80;
        let percentage = score * 100 / total;
        // Serialize the replay check with the award, including across app instances.
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        crate::backup::ensure_epoch(&tx, &self.data_epoch)?;
        let prior = tx
            .query_row(
                "SELECT topic_id,answers_json,feedback_json FROM quiz_attempts WHERE attempt_id=?1",
                [attempt_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        if let Some((old_topic, old_answers, old_feedback)) = prior {
            if old_topic != topic_id || old_answers != answers_json {
                return Err(invalid(
                    "This attempt ID was already used with different answers.",
                ));
            }
            let attempt = tx.query_row("SELECT attempt_id,topic_id,score,total,passed,xp_awarded,created_at FROM quiz_attempts WHERE attempt_id=?1", [attempt_id], attempt_from_row)?;
            let feedback = serde_json::from_str(&old_feedback)?;
            tx.commit()?;
            return Ok(QuizResult {
                attempt,
                feedback,
                dashboard: self.dashboard()?,
                review_update: crate::review::event(&self.conn, attempt_id)?,
                review_summary: self.get_review_summary()?,
            });
        }
        // Timestamp accepted attempts under the same write lock, so competing
        // app instances cannot commit an older sampled time after a newer one.
        let timestamp = now();
        let xp_awarded = if passed {
            award(&tx, &format!("quiz-pass:{topic_id}"), 100, &timestamp)?
        } else {
            0
        };
        tx.execute("INSERT INTO quiz_attempts(attempt_id,topic_id,answers_json,score,total,passed,xp_awarded,feedback_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![attempt_id,topic_id,answers_json,score,total,passed,xp_awarded,serde_json::to_string(&feedback)?,timestamp])?;
        tx.execute("UPDATE topic_progress SET mastery=CASE WHEN ?2 THEN 'passed' ELSE 'needs_review' END,best_score=MAX(COALESCE(best_score,0),?3),last_studied_at=?4 WHERE topic_id=?1",params![topic_id,passed,percentage,timestamp])?;
        if passed {
            tx.execute("INSERT OR IGNORE INTO achievements(id,title,earned_at) VALUES('first-mastery','First Check Passed',?1)",[&timestamp])?;
        }
        let review_update = crate::review::apply_attempt(&tx, attempt_id)?;
        activity(&tx)?;
        tx.commit()?;
        Ok(QuizResult {
            attempt: QuizAttempt {
                attempt_id: attempt_id.into(),
                topic_id: topic_id.into(),
                score,
                total,
                passed,
                xp_awarded,
                created_at: timestamp,
            },
            feedback,
            dashboard: self.dashboard()?,
            review_update,
            review_summary: self.get_review_summary()?,
        })
    }
    pub fn import_book_pdf(
        &mut self,
        book_id: &str,
        file_name: &str,
        bytes: &[u8],
    ) -> Result<BookDocument> {
        self.ensure_available()?;
        let _write_guard = crate::backup::shared_gate(self.write_gate.as_ref())?;
        self.require_book(book_id)?;
        if bytes.len() > MAX_PDF_BYTES || bytes.len() < 8 || !bytes.starts_with(b"%PDF-") {
            return Err(invalid("Choose a valid PDF under 100 MiB."));
        }
        let file_name = file_name.rsplit(['/', '\\']).next().unwrap_or("book.pdf");
        if file_name.is_empty() || file_name.len() > 255 || file_name.chars().any(char::is_control)
        {
            return Err(invalid("Choose a PDF with a valid file name."));
        }
        let imported_at = now();
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        crate::backup::ensure_epoch(&tx, &self.data_epoch)?;
        let existing = tx.query_row("SELECT imported_at,document_revision,bytes=?2 FROM book_documents WHERE book_id=?1", params![book_id,bytes], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,bool>(2)?))).optional()?;
        // Reimporting identical bytes preserves bookmarks, position and revision.
        let (imported_at, document_revision) = if let Some((old_timestamp, revision, true)) =
            existing
        {
            tx.execute(
                "UPDATE book_documents SET file_name=?2 WHERE book_id=?1",
                params![book_id, file_name],
            )?;
            (old_timestamp, revision)
        } else {
            let revision: String =
                tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
            tx.execute("INSERT INTO book_documents(book_id,file_name,imported_at,bytes,document_revision) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(book_id) DO UPDATE SET file_name=excluded.file_name,imported_at=excluded.imported_at,bytes=excluded.bytes,document_revision=excluded.document_revision",params![book_id,file_name,imported_at,bytes,revision])?;
            // Previous revision metadata is retained, but cannot affect the new PDF.
            (imported_at, revision)
        };
        tx.commit()?;
        Ok(BookDocument {
            book_id: book_id.into(),
            file_name: file_name.into(),
            imported_at,
            document_revision,
        })
    }

    pub fn get_book_document(&self, book_id: &str) -> Result<Option<BookDocument>> {
        self.require_book(book_id)?;
        Ok(self
            .conn
            .query_row(
                "SELECT book_id,file_name,imported_at,document_revision FROM book_documents WHERE book_id=?1",
                [book_id],
                |r| {
                    Ok(BookDocument {
                        book_id: r.get(0)?,
                        file_name: r.get(1)?,
                        imported_at: r.get(2)?,
                        document_revision: r.get(3)?,
                    })
                },
            )
            .optional()?)
    }
    pub fn get_book_reader_state(&self, book_id: &str) -> Result<BookReaderState> {
        self.require_book(book_id)?;
        let tx = self.conn.unchecked_transaction()?;
        let state = reader_state(&tx, book_id)?;
        tx.commit()?;
        Ok(state)
    }
    pub fn set_book_page(&mut self, book_id: &str, page: i64, revision: &str) -> Result<()> {
        self.ensure_available()?;
        let _write_guard = crate::backup::shared_gate(self.write_gate.as_ref())?;
        self.require_book(book_id)?;
        validate_page(page)?;
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        crate::backup::ensure_epoch(&tx, &self.data_epoch)?;
        require_revision(&tx, book_id, revision)?;
        tx.execute("INSERT INTO reader_positions(book_id,document_revision,page,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(book_id,document_revision) DO UPDATE SET page=excluded.page,updated_at=excluded.updated_at",params![book_id,revision,page,now()])?;
        tx.commit()?;
        Ok(())
    }
    pub fn add_bookmark(
        &mut self,
        book_id: &str,
        page: i64,
        label: &str,
        revision: &str,
    ) -> Result<BookReaderState> {
        self.ensure_available()?;
        let _write_guard = crate::backup::shared_gate(self.write_gate.as_ref())?;
        self.require_book(book_id)?;
        validate_page(page)?;
        let label = label.trim();
        if label.chars().count() > 200 || label.chars().any(char::is_control) {
            return Err(invalid(
                "Bookmark labels must be a single line of at most 200 characters.",
            ));
        }
        let label = if label.is_empty() {
            format!("Page {page}")
        } else {
            label.into()
        };
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        crate::backup::ensure_epoch(&tx, &self.data_epoch)?;
        require_revision(&tx, book_id, revision)?;
        let count: i64 = tx.query_row("SELECT count(*) FROM page_bookmarks WHERE book_id=?1 AND document_revision=?2 AND deleted_at IS NULL",params![book_id,revision],|r|r.get(0))?;
        let already_exists = tx.query_row("SELECT 1 FROM page_bookmarks WHERE book_id=?1 AND document_revision=?2 AND page=?3 AND deleted_at IS NULL",params![book_id,revision,page],|_|Ok(())).optional()?.is_some();
        if count >= 1000 && !already_exists {
            return Err(invalid(
                "This PDF already has 1,000 bookmarks. Remove a bookmark before adding another.",
            ));
        }
        tx.execute("INSERT INTO page_bookmarks(id,book_id,document_revision,page,label,created_at) VALUES(lower(hex(randomblob(16))),?1,?2,?3,?4,?5) ON CONFLICT(book_id,document_revision,page) DO UPDATE SET label=excluded.label,deleted_at=NULL",params![book_id,revision,page,label,now()])?;
        let state = reader_state(&tx, book_id)?;
        tx.commit()?;
        Ok(state)
    }
    pub fn remove_bookmark(
        &mut self,
        book_id: &str,
        bookmark_id: &str,
        revision: &str,
    ) -> Result<BookReaderState> {
        self.ensure_available()?;
        let _write_guard = crate::backup::shared_gate(self.write_gate.as_ref())?;
        self.require_book(book_id)?;
        if bookmark_id.len() != 32 || !bookmark_id.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(invalid("Invalid bookmark ID."));
        }
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        crate::backup::ensure_epoch(&tx, &self.data_epoch)?;
        require_revision(&tx, book_id, revision)?;
        let changed = tx.execute("UPDATE page_bookmarks SET deleted_at=COALESCE(deleted_at,?4) WHERE id=?1 AND book_id=?2 AND document_revision=?3",params![bookmark_id,book_id,revision,now()])?;
        if changed == 0 {
            return Err(invalid("This bookmark does not belong to the current PDF."));
        }
        let state = reader_state(&tx, book_id)?;
        tx.commit()?;
        Ok(state)
    }
    pub fn get_book_pdf_for_revision(
        &self,
        book_id: &str,
        revision: Option<&str>,
    ) -> Result<Vec<u8>> {
        self.require_book(book_id)?;
        match revision {
            None => self.get_book_pdf(book_id),
            Some(revision) => {
                let tx = self.conn.unchecked_transaction()?;
                require_revision(&tx, book_id, revision)?;
                let bytes = tx.query_row(
                    "SELECT bytes FROM book_documents WHERE book_id=?1 AND document_revision=?2",
                    params![book_id, revision],
                    |r| r.get(0),
                )?;
                tx.commit()?;
                Ok(bytes)
            }
        }
    }
    pub fn get_book_pdf(&self, book_id: &str) -> Result<Vec<u8>> {
        self.require_book(book_id)?;
        self.conn
            .query_row(
                "SELECT bytes FROM book_documents WHERE book_id=?1",
                [book_id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| invalid("Import your local PDF for this book first."))
    }
}
fn validate_page(page: i64) -> Result<()> {
    if !(1..=100_000).contains(&page) {
        return Err(invalid("PDF page numbers must be between 1 and 100,000."));
    }
    Ok(())
}
fn require_revision(conn: &Connection, book_id: &str, revision: &str) -> Result<()> {
    if revision.len() != 32 || !revision.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(invalid("Invalid PDF document revision."));
    }
    let current: Option<String> = conn
        .query_row(
            "SELECT document_revision FROM book_documents WHERE book_id=?1",
            [book_id],
            |r| r.get(0),
        )
        .optional()?;
    match current {
        Some(current) if current==revision => Ok(()),
        None => Err(invalid("Import a local PDF for this book first.")),
        Some(_) => Err(AppError {code:"stale_document",message:"This PDF was replaced in another window. Reopen the book before saving pages or bookmarks.".into()}),
    }
}
fn reader_state(conn: &Connection, book_id: &str) -> Result<BookReaderState> {
    let revision: Option<String> = conn
        .query_row(
            "SELECT document_revision FROM book_documents WHERE book_id=?1",
            [book_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(revision) = revision else {
        return Ok(BookReaderState {
            page: 1,
            document_revision: None,
            bookmarks: Vec::new(),
        });
    };
    let page = conn
        .query_row(
            "SELECT page FROM reader_positions WHERE book_id=?1 AND document_revision=?2",
            params![book_id, revision],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(1);
    let bookmarks=conn.prepare("SELECT id,page,label,created_at FROM page_bookmarks WHERE book_id=?1 AND document_revision=?2 AND deleted_at IS NULL ORDER BY page,id")?.query_map(params![book_id,revision],|r|Ok(PageBookmark {id:r.get(0)?,page:r.get(1)?,label:r.get(2)?,created_at:r.get(3)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(BookReaderState {
        page,
        document_revision: Some(revision),
        bookmarks,
    })
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key]
        .as_str()
        .ok_or_else(|| invalid("Invalid bundled curriculum field."))
}
fn attempt_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<QuizAttempt> {
    Ok(QuizAttempt {
        attempt_id: r.get(0)?,
        topic_id: r.get(1)?,
        score: r.get(2)?,
        total: r.get(3)?,
        passed: r.get(4)?,
        xp_awarded: r.get(5)?,
        created_at: r.get(6)?,
    })
}
fn award(tx: &Transaction<'_>, key: &str, amount: i64, timestamp: &str) -> Result<i64> {
    Ok(
        if tx.execute(
            "INSERT OR IGNORE INTO xp_ledger(event_key,amount,created_at) VALUES(?1,?2,?3)",
            params![key, amount, timestamp],
        )? > 0
        {
            amount
        } else {
            0
        },
    )
}
fn activity(tx: &Transaction<'_>) -> Result<()> {
    tx.execute(
        "INSERT OR IGNORE INTO activity_days(day) VALUES(?1)",
        [Local::now().date_naive().to_string()],
    )?;
    Ok(())
}
fn streak(days: &[String], today: NaiveDate) -> i64 {
    let mut expected = today;
    if !days.iter().any(|d| d == &today.to_string()) {
        expected = today - Duration::days(1);
    }
    let mut count = 0;
    while days.iter().any(|d| d == &expected.to_string()) {
        count += 1;
        expected -= Duration::days(1);
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    fn memory() -> Store {
        Store::initialize(Connection::open_in_memory().unwrap()).unwrap()
    }
    fn correct_answers(store: &Store, topic: &str) -> Vec<usize> {
        store
            .questions(topic)
            .unwrap()
            .iter()
            .map(|q| q["correctIndex"].as_u64().unwrap() as usize)
            .collect()
    }
    #[test]
    fn pristine_curriculum_has_no_earned_progress() {
        let store = memory();
        let dashboard = store.dashboard().unwrap();
        assert_eq!(dashboard.topics.len(), 24);
        assert_eq!(dashboard.total_xp, 0);
        assert_eq!(dashboard.level, 1);
        assert!(dashboard.achievements.is_empty());
        assert!(dashboard.attempts.is_empty());
        assert!(dashboard
            .topics
            .iter()
            .all(|t| t.status == "not_started" && t.mastery == "untested"));
    }
    #[test]
    fn reading_is_independent_from_mastery_and_cannot_farm_xp() {
        let mut store = memory();
        store.set_topic_status("cache-locality", "read").unwrap();
        store
            .set_topic_status("cache-locality", "not_started")
            .unwrap();
        let state = store.set_topic_status("cache-locality", "read").unwrap();
        assert_eq!(state.total_xp, 20);
        assert_eq!(state.achievements.len(), 1);
        let topic = state
            .topics
            .iter()
            .find(|t| t.topic_id == "cache-locality")
            .unwrap();
        assert_eq!(topic.mastery, "untested");
    }
    #[test]
    fn attempts_are_authoritatively_graded_replay_safe_and_cannot_farm_xp() {
        let mut store = memory();
        let answers = correct_answers(&store, "cache-locality");
        let first = store
            .submit_quiz("cache-locality", answers.clone(), "attempt-0001")
            .unwrap();
        assert!(first.attempt.passed);
        assert_eq!(first.attempt.xp_awarded, 100);
        let replay = store
            .submit_quiz("cache-locality", answers.clone(), "attempt-0001")
            .unwrap();
        assert_eq!(replay.dashboard.attempts.len(), 1);
        assert_eq!(replay.dashboard.total_xp, 100);
        let later = store
            .submit_quiz("cache-locality", answers.clone(), "attempt-0002")
            .unwrap();
        assert_eq!(later.attempt.xp_awarded, 0);
        assert_eq!(later.dashboard.total_xp, 100);
        let wrong = vec![(answers[0] + 1) % 4];
        assert!(store
            .submit_quiz("cache-locality", wrong.clone(), "attempt-0001")
            .is_err());
        let failed = store
            .submit_quiz("cache-locality", wrong, "attempt-0003")
            .unwrap();
        assert!(!failed.attempt.passed);
        assert_eq!(failed.attempt.xp_awarded, 0);
        let topic = failed
            .dashboard
            .topics
            .iter()
            .find(|t| t.topic_id == "cache-locality")
            .unwrap();
        assert_eq!(topic.mastery, "needs_review");
        assert_eq!(topic.status, "not_started");
        assert_eq!(topic.best_score, Some(100));
    }
    #[test]
    fn invalid_submissions_make_no_partial_writes() {
        let mut store = memory();
        assert!(store
            .submit_quiz("cache-locality", vec![], "attempt-invalid")
            .is_err());
        assert!(store
            .submit_quiz("cache-locality", vec![999], "attempt-invalid")
            .is_err());
        assert!(store
            .submit_quiz("unknown", vec![0], "attempt-invalid")
            .is_err());
        assert!(store
            .set_topic_status("cache-locality", "mastered")
            .is_err());
        assert!(store.save_note("unknown", "no").is_err());
        assert_eq!(store.dashboard().unwrap().total_xp, 0);
        assert!(store.dashboard().unwrap().attempts.is_empty());
    }
    #[test]
    fn migration_and_notes_survive_reopen() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("test.sqlite3");
        {
            let mut store = Store::open(&path).unwrap();
            store
                .save_note("cache-locality", "My own cache observations.")
                .unwrap();
            store.set_topic_status("cache-locality", "read").unwrap();
        }
        let store = Store::open(&path).unwrap();
        let state = store.dashboard().unwrap();
        assert_eq!(state.notes[0].body, "My own cache observations.");
        assert_eq!(state.total_xp, 20);
        let version: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 6);
    }
    #[test]
    fn pdf_import_is_local_validated_and_replaces_atomically() {
        let mut store = memory();
        let bytes = b"%PDF-1.7\nprivate local test fixture";
        assert!(store.get_book_document("csapp").unwrap().is_none());
        store
            .import_book_pdf("csapp", "/private/test.pdf", bytes)
            .unwrap();
        assert_eq!(
            store.get_book_document("csapp").unwrap().unwrap().file_name,
            "test.pdf"
        );
        assert_eq!(store.get_book_pdf("csapp").unwrap(), bytes);
        assert!(store
            .import_book_pdf("csapp", "bad.pdf", b"not pdf!")
            .is_err());
        assert_eq!(store.get_book_pdf("csapp").unwrap(), bytes);
    }
    #[test]
    fn public_quiz_contains_no_answer_key() {
        let store = memory();
        let quiz = serde_json::to_value(store.get_quiz("cache-locality").unwrap()).unwrap();
        assert!(quiz["questions"][0].get("correctIndex").is_none());
        assert!(quiz["questions"][0].get("explanation").is_none());
        assert_eq!(quiz["questions"][0]["options"].as_array().unwrap().len(), 4);
    }
    #[test]
    fn streak_accepts_yesterday_and_breaks_on_gaps() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 10).unwrap();
        assert_eq!(
            streak(&["2026-11-09".into(), "2026-11-08".into()], today),
            2
        );
        assert_eq!(
            streak(&["2026-11-10".into(), "2026-11-08".into()], today),
            1
        );
        assert_eq!(streak(&["2026-11-08".into()], today), 0);
    }

    #[test]
    fn concurrent_duplicate_attempts_both_return_the_same_persisted_result() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("concurrent.sqlite3");
        let mut first = Store::open(&path).unwrap();
        let mut second = Store::open(&path).unwrap();
        let answers = correct_answers(&first, "cache-locality");
        let other_answers = answers.clone();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let other_barrier = barrier.clone();
        let a = std::thread::spawn(move || {
            barrier.wait();
            first
                .submit_quiz("cache-locality", answers, "shared-attempt-01")
                .unwrap()
        });
        let b = std::thread::spawn(move || {
            other_barrier.wait();
            second
                .submit_quiz("cache-locality", other_answers, "shared-attempt-01")
                .unwrap()
        });
        assert_eq!(a.join().unwrap().attempt.xp_awarded, 100);
        assert_eq!(b.join().unwrap().attempt.xp_awarded, 100);
        let state = Store::open(&path).unwrap().dashboard().unwrap();
        assert_eq!(state.attempts.len(), 1);
        assert_eq!(state.total_xp, 100);
        let review = Store::open(&path).unwrap().get_review_summary().unwrap();
        assert_eq!(review.events.len(), 1);
        assert_eq!(review.upcoming[0].successful_reviews, 1);
    }
    const TEST_PDF: &[u8] = b"%PDF-1.7\nlocal reader fixture";
    #[test]
    fn reader_state_defaults_and_pages_bookmarks_persist_without_xp() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("reader.sqlite3");
        let revision;
        {
            let mut store = Store::open(&path).unwrap();
            let empty = store.get_book_reader_state("csapp").unwrap();
            assert_eq!(empty.page, 1);
            assert!(empty.document_revision.is_none());
            assert!(empty.bookmarks.is_empty());
            revision = store
                .import_book_pdf("csapp", "test.pdf", TEST_PDF)
                .unwrap()
                .document_revision;
            store.set_book_page("csapp", 12, &revision).unwrap();
            store
                .add_bookmark("csapp", 12, "Measured locality", &revision)
                .unwrap();
            let state = store.add_bookmark("csapp", 3, "", &revision).unwrap();
            assert_eq!(state.bookmarks[0].page, 3);
            assert_eq!(state.bookmarks[0].label, "Page 3");
            assert_eq!(state.bookmarks[1].page, 12);
            assert_eq!(store.dashboard().unwrap().total_xp, 0);
            assert_eq!(store.dashboard().unwrap().streak_days, 0);
        }
        let store = Store::open(&path).unwrap();
        let state = store.get_book_reader_state("csapp").unwrap();
        assert_eq!(state.page, 12);
        assert_eq!(state.document_revision.as_deref(), Some(revision.as_str()));
        assert_eq!(state.bookmarks.len(), 2);
        assert_eq!(state.bookmarks[1].label, "Measured locality");
    }
    #[test]
    fn bookmark_upsert_remove_and_readd_keep_one_stable_page_bookmark() {
        let mut store = memory();
        let revision = store
            .import_book_pdf("csapp", "test.pdf", TEST_PDF)
            .unwrap()
            .document_revision;
        let first = store
            .add_bookmark("csapp", 7, "First label", &revision)
            .unwrap();
        let id = first.bookmarks[0].id.clone();
        let created = first.bookmarks[0].created_at.clone();
        let updated = store
            .add_bookmark("csapp", 7, "  Revised label  ", &revision)
            .unwrap();
        assert_eq!(updated.bookmarks.len(), 1);
        assert_eq!(updated.bookmarks[0].id, id);
        assert_eq!(updated.bookmarks[0].created_at, created);
        assert_eq!(updated.bookmarks[0].label, "Revised label");
        assert!(store
            .remove_bookmark("csapp", &id, &revision)
            .unwrap()
            .bookmarks
            .is_empty());
        assert!(store
            .remove_bookmark("csapp", &id, &revision)
            .unwrap()
            .bookmarks
            .is_empty());
        let revived = store
            .add_bookmark("csapp", 7, "Recovered", &revision)
            .unwrap();
        assert_eq!(revived.bookmarks.len(), 1);
        assert_eq!(revived.bookmarks[0].id, id);
    }
    #[test]
    fn reader_rejects_invalid_pages_labels_and_unknown_documents_without_writes() {
        let mut store = memory();
        assert!(store.get_book_reader_state("missing").is_err());
        assert!(store.set_book_page("csapp", 1, &"0".repeat(32)).is_err());
        let revision = store
            .import_book_pdf("csapp", "test.pdf", TEST_PDF)
            .unwrap()
            .document_revision;
        for page in [-1, 0, 100_001, i64::MAX] {
            assert!(store.set_book_page("csapp", page, &revision).is_err());
            assert!(store.add_bookmark("csapp", page, "bad", &revision).is_err());
        }
        assert!(store
            .add_bookmark("csapp", 2, &"x".repeat(201), &revision)
            .is_err());
        assert!(store
            .add_bookmark("csapp", 2, "two\nlines", &revision)
            .is_err());
        assert!(store
            .add_bookmark("csapp", 2, "control\0text", &revision)
            .is_err());
        assert!(store.set_book_page("missing", 2, &revision).is_err());
        assert!(store.set_book_page("csapp", 2, "not-a-revision").is_err());
        let state = store.get_book_reader_state("csapp").unwrap();
        assert_eq!(state.page, 1);
        assert!(state.bookmarks.is_empty());
        // The backend caps numerical input; the frontend verifies the actual PDF length.
        store.set_book_page("csapp", 100_000, &revision).unwrap();
        assert_eq!(store.get_book_reader_state("csapp").unwrap().page, 100_000);
    }
    #[test]
    fn identical_reimport_preserves_state_but_replacement_isolates_old_revision() {
        let mut store = memory();
        let first = store
            .import_book_pdf("csapp", "first.pdf", TEST_PDF)
            .unwrap();
        let revision = first.document_revision.clone();
        store.set_book_page("csapp", 8, &revision).unwrap();
        let bookmark = store
            .add_bookmark("csapp", 8, "Old edition", &revision)
            .unwrap()
            .bookmarks
            .remove(0);
        let same = store
            .import_book_pdf("csapp", "same.pdf", TEST_PDF)
            .unwrap();
        assert_eq!(same.document_revision, revision);
        assert_eq!(same.imported_at, first.imported_at);
        assert_eq!(store.get_book_reader_state("csapp").unwrap().page, 8);
        assert_eq!(
            store
                .get_book_reader_state("csapp")
                .unwrap()
                .bookmarks
                .len(),
            1
        );
        let replacement = store
            .import_book_pdf("csapp", "new.pdf", b"%PDF-1.7\ndifferent document")
            .unwrap();
        assert_ne!(replacement.document_revision, revision);
        let state = store.get_book_reader_state("csapp").unwrap();
        assert_eq!(state.page, 1);
        assert!(state.bookmarks.is_empty());
        assert_eq!(
            store.set_book_page("csapp", 4, &revision).unwrap_err().code,
            "stale_document"
        );
        assert_eq!(
            store
                .add_bookmark("csapp", 4, "stale", &revision)
                .unwrap_err()
                .code,
            "stale_document"
        );
        assert_eq!(
            store
                .remove_bookmark("csapp", &bookmark.id, &revision)
                .unwrap_err()
                .code,
            "stale_document"
        );
        assert_eq!(
            store
                .get_book_pdf_for_revision("csapp", Some(&revision))
                .unwrap_err()
                .code,
            "stale_document"
        );
        assert_eq!(
            store
                .get_book_pdf_for_revision("csapp", Some(&replacement.document_revision))
                .unwrap(),
            b"%PDF-1.7\ndifferent document"
        );
        let count: i64 = store
            .conn
            .query_row(
                "SELECT count(*) FROM page_bookmarks WHERE id=?1",
                [&bookmark.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "Prior metadata must be retained rather than erased during replacement"
        );
    }
    #[test]
    fn replacement_from_another_connection_rejects_stale_reader_writes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("replacement.sqlite3");
        let mut first = Store::open(&path).unwrap();
        let revision = first
            .import_book_pdf("csapp", "first.pdf", TEST_PDF)
            .unwrap()
            .document_revision;
        let mut second = Store::open(&path).unwrap();
        let new_revision = second
            .import_book_pdf("csapp", "second.pdf", b"%PDF-1.7\nsecond PDF")
            .unwrap()
            .document_revision;
        assert_eq!(
            first.set_book_page("csapp", 3, &revision).unwrap_err().code,
            "stale_document"
        );
        first.set_book_page("csapp", 2, &new_revision).unwrap();
        assert_eq!(second.get_book_reader_state("csapp").unwrap().page, 2);
    }
    #[test]
    fn bookmarks_cannot_be_removed_through_another_book() {
        let mut store = memory();
        let a = store
            .import_book_pdf("csapp", "a.pdf", TEST_PDF)
            .unwrap()
            .document_revision;
        let b = store
            .import_book_pdf("ostep", "b.pdf", TEST_PDF)
            .unwrap()
            .document_revision;
        let bookmark = store
            .add_bookmark("csapp", 5, "Memory", &a)
            .unwrap()
            .bookmarks
            .remove(0);
        assert!(store.remove_bookmark("ostep", &bookmark.id, &b).is_err());
        assert_eq!(
            store
                .get_book_reader_state("csapp")
                .unwrap()
                .bookmarks
                .len(),
            1
        );
        assert!(store
            .get_book_reader_state("ostep")
            .unwrap()
            .bookmarks
            .is_empty());
    }
    #[test]
    fn migration_two_preserves_version_one_pdf_notes_and_xp() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("old.sqlite3");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(include_str!("../migrations/001_initial.sql"))
                .unwrap();
            conn.pragma_update(None, "user_version", 1).unwrap();
            conn.execute(
                "INSERT INTO books(id,title,metadata_json) VALUES('csapp','Original book','{}')",
                [],
            )
            .unwrap();
            conn.execute("INSERT INTO topics(id,book_id,title,metadata_json) VALUES('cache-locality','csapp','Caches','{}')", []).unwrap();
            conn.execute(
                "INSERT INTO topic_progress(topic_id,status) VALUES('cache-locality','read')",
                [],
            )
            .unwrap();
            conn.execute("INSERT INTO notes(topic_id,body,updated_at) VALUES('cache-locality','Keep my observation','2026-11-10')", []).unwrap();
            conn.execute("INSERT INTO xp_ledger(event_key,amount,created_at) VALUES('read:cache-locality',20,'2026-11-10')", []).unwrap();
            conn.execute("INSERT INTO book_documents(book_id,file_name,imported_at,bytes) VALUES('csapp','old.pdf','2026-11-10',?1)", [TEST_PDF]).unwrap();
        }
        let revision;
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(store.dashboard().unwrap().total_xp, 20);
            assert_eq!(
                store.dashboard().unwrap().notes[0].body,
                "Keep my observation"
            );
            assert_eq!(store.get_book_pdf("csapp").unwrap(), TEST_PDF);
            let doc = store.get_book_document("csapp").unwrap().unwrap();
            assert_eq!(doc.imported_at, "2026-11-10");
            assert_eq!(doc.file_name, "old.pdf");
            assert_eq!(doc.document_revision.len(), 32);
            revision = doc.document_revision;
            let state = store.get_book_reader_state("csapp").unwrap();
            assert_eq!(state.page, 1);
            assert!(state.bookmarks.is_empty());
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(
            store
                .get_book_document("csapp")
                .unwrap()
                .unwrap()
                .document_revision,
            revision
        );
        assert_eq!(store.dashboard().unwrap().total_xp, 20);
    }
    #[test]
    fn focus_sessions_validate_topics_and_never_award_progress() {
        let mut store = memory();
        assert!(store.start_focus_session("unknown", "focus-0001").is_err());
        let started = store
            .start_focus_session("cache-locality", "focus-0001")
            .unwrap();
        assert!(started.active_session.is_some());
        store.tick_focus_session("focus-0001", 1, false).unwrap();
        store.tick_focus_session("focus-0001", 2, true).unwrap();
        let dashboard = store.dashboard().unwrap();
        assert_eq!(dashboard.total_xp, 0);
        assert_eq!(dashboard.streak_days, 0);
        assert!(dashboard.achievements.is_empty());
        assert!(dashboard
            .topics
            .iter()
            .all(|t| t.status == "not_started" && t.mastery == "untested"));
    }
    #[test]
    fn scheduling_is_atomic_with_the_grade_and_xp_award() {
        let mut store = memory();
        let answers = correct_answers(&store, "cache-locality");
        store.conn.execute_batch("CREATE TRIGGER reject_review BEFORE INSERT ON review_events BEGIN SELECT RAISE(ABORT,'test-only forced failure'); END;").unwrap();
        assert!(store
            .submit_quiz("cache-locality", answers, "atomic-review-01")
            .is_err());
        let state = store.dashboard().unwrap();
        assert_eq!(state.total_xp, 0);
        assert!(state.attempts.is_empty());
        assert!(state.achievements.is_empty());
        assert_eq!(
            state
                .topics
                .iter()
                .find(|t| t.topic_id == "cache-locality")
                .unwrap()
                .mastery,
            "untested"
        );
        let review = store.get_review_summary().unwrap();
        assert_eq!(review.total_scheduled, 0);
        assert!(review.events.is_empty());
    }
    #[test]
    fn quiz_replays_return_the_original_review_effect_without_promoting_or_farming() {
        let mut store = memory();
        let answers = correct_answers(&store, "cache-locality");
        let first = store
            .submit_quiz("cache-locality", answers.clone(), "review-first-01")
            .unwrap();
        assert!(first.review_update.qualified);
        assert_eq!(first.review_update.successful_reviews_after, 1);
        assert_eq!(first.review_summary.mastered_count, 0);
        let replay = store
            .submit_quiz("cache-locality", answers.clone(), "review-first-01")
            .unwrap();
        assert_eq!(replay.review_update.reason, "first_pass");
        assert_eq!(replay.review_summary.events.len(), 1);
        let practice = store
            .submit_quiz("cache-locality", answers, "review-practice-01")
            .unwrap();
        assert!(!practice.review_update.qualified);
        assert_eq!(practice.review_update.reason, "early_practice");
        assert_eq!(practice.review_update.successful_reviews_after, 1);
        assert_eq!(
            practice.review_update.due_at_after,
            first.review_update.due_at_after
        );
        assert_eq!(practice.dashboard.total_xp, 100);
        assert_eq!(practice.attempt.xp_awarded, 0);
        let replay_again = store
            .submit_quiz(
                "cache-locality",
                correct_answers(&store, "cache-locality"),
                "review-first-01",
            )
            .unwrap();
        assert_eq!(replay_again.review_update.reason, "first_pass");
        assert_eq!(replay_again.review_summary.events.len(), 2);
    }
    #[test]
    fn migration_four_backfills_all_attempts_and_preserves_version_three_user_data() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("v3.sqlite3");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(include_str!("../migrations/001_initial.sql"))
                .unwrap();
            conn.execute_batch(include_str!("../migrations/002_reader_state.sql"))
                .unwrap();
            conn.execute_batch(include_str!("../migrations/003_focus_sessions.sql"))
                .unwrap();
            conn.pragma_update(None, "user_version", 3).unwrap();
            conn.execute(
                "INSERT INTO books(id,title,metadata_json) VALUES('csapp','Old title','{}')",
                [],
            )
            .unwrap();
            for topic in ["cache-locality", "cuda-memory"] {
                conn.execute(
                    "INSERT INTO topics(id,book_id,title,metadata_json) VALUES(?1,'csapp',?1,'{}')",
                    [topic],
                )
                .unwrap();
                conn.execute("INSERT INTO topic_progress(topic_id,status,mastery,best_score) VALUES(?1,'read','passed',100)",[topic]).unwrap();
            }
            for (index, date) in [
                "2026-10-01T10:00:00Z",
                "2026-10-02T10:00:00Z",
                "2026-10-05T10:00:00Z",
            ]
            .into_iter()
            .enumerate()
            {
                conn.execute("INSERT INTO quiz_attempts(attempt_id,topic_id,answers_json,score,total,passed,xp_awarded,feedback_json,created_at) VALUES(?1,'cache-locality','[2]',1,1,1,0,'[]',?2)",params![format!("historic-{index}"),date]).unwrap();
            }
            for index in 0..105 {
                conn.execute("INSERT INTO quiz_attempts(attempt_id,topic_id,answers_json,score,total,passed,xp_awarded,feedback_json,created_at) VALUES(?1,'cuda-memory','[1]',1,1,1,0,'[]','2026-11-10T10:00:00Z')",[format!("practice-{index:03}")]).unwrap();
            }
            conn.execute("INSERT INTO xp_ledger(event_key,amount,created_at) VALUES('quiz-pass:cache-locality',100,'2026-10-01T10:00:00Z')",[]).unwrap();
            conn.execute("INSERT INTO achievements(id,title,earned_at) VALUES('first-mastery','First Mastery','2026-10-01T10:00:00Z')",[]).unwrap();
            conn.execute("INSERT INTO notes(topic_id,body,updated_at) VALUES('cache-locality','Original observations','2026-10-01T10:00:00Z')",[]).unwrap();
            conn.execute("INSERT INTO book_documents(book_id,file_name,imported_at,bytes,document_revision) VALUES('csapp','original.pdf','2026-10-01T10:00:00Z',?1,'11111111111111111111111111111111')",[TEST_PDF]).unwrap();
            conn.execute("INSERT INTO reader_positions(book_id,document_revision,page,updated_at) VALUES('csapp','11111111111111111111111111111111',5,'2026-10-01T10:00:00Z')",[]).unwrap();
            conn.execute("INSERT INTO page_bookmarks(id,book_id,document_revision,page,label,created_at) VALUES('22222222222222222222222222222222','csapp','11111111111111111111111111111111',5,'Keep me','2026-10-01T10:00:00Z')",[]).unwrap();
            conn.execute("INSERT INTO focus_sessions(id,topic_id,owner_token,status,started_at,updated_at,ended_at,elapsed_ms) VALUES('historic-focus','cache-locality','old-owner','completed','2026-10-01T10:00:00Z','2026-10-01T10:01:00Z','2026-10-01T10:01:00Z',60000)",[]).unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            let review = store.get_review_summary().unwrap();
            assert_eq!(review.total_scheduled, 2);
            assert_eq!(review.mastered_count, 1);
            assert_eq!(review.events.len(), 100);
            assert!(review.events.iter().all(|e| e.topic_id == "cuda-memory"));
            let count: i64 = store
                .conn
                .query_row("SELECT count(*) FROM quiz_attempts", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 108);
            let events: i64 = store
                .conn
                .query_row("SELECT count(*) FROM review_events", [], |r| r.get(0))
                .unwrap();
            assert_eq!(events, 108);
            let state = store.dashboard().unwrap();
            assert_eq!(state.total_xp, 100);
            assert_eq!(state.notes[0].body, "Original observations");
            let achievement = state
                .achievements
                .iter()
                .find(|a| a.id == "first-mastery")
                .unwrap();
            assert_eq!(achievement.title, "First Check Passed");
            assert_eq!(achievement.earned_at, "2026-10-01T10:00:00Z");
            assert_eq!(store.get_book_pdf("csapp").unwrap(), TEST_PDF);
            let reader = store.get_book_reader_state("csapp").unwrap();
            assert_eq!(reader.page, 5);
            assert_eq!(reader.bookmarks[0].label, "Keep me");
            assert_eq!(store.get_focus_summary().unwrap().total_seconds, 60);
        }
        let reopened = Store::open(&path).unwrap();
        assert_eq!(reopened.get_review_summary().unwrap().mastered_count, 1);
        let events: i64 = reopened
            .conn
            .query_row("SELECT count(*) FROM review_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(events, 108);
        assert_eq!(reopened.dashboard().unwrap().total_xp, 100);
    }
    #[test]
    fn independent_connections_keep_awards_unique() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("test.sqlite3");
        let mut first = Store::open(&path).unwrap();
        let mut second = Store::open(&path).unwrap();
        first.set_topic_status("cache-locality", "read").unwrap();
        second
            .set_topic_status("cache-locality", "reading")
            .unwrap();
        second.set_topic_status("cache-locality", "read").unwrap();
        assert_eq!(first.dashboard().unwrap().total_xp, 20);
    }
}
