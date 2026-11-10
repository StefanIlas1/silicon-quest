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
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDocument {
    pub book_id: String,
    pub file_name: String,
    pub imported_at: String,
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
    conn: Connection,
    curriculum: Value,
}
impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::initialize(conn)
    }
    fn initialize(mut conn: Connection) -> Result<Self> {
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > 1 {
            return Err(AppError { code: "newer_database", message: "This database was created by a newer Silicon Quest version. Update the app to open it.".into() });
        }
        if version < 1 {
            let tx = conn.transaction()?;
            tx.execute_batch(include_str!("../migrations/001_initial.sql"))?;
            tx.pragma_update(None, "user_version", 1)?;
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
        tx.commit()?;
        Ok(Self { conn, curriculum })
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
        self.require_topic(topic_id)?;
        if !["not_started", "reading", "read"].contains(&status) {
            return Err(invalid("Unknown reading status."));
        }
        let timestamp = now();
        let tx = self.conn.transaction()?;
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
        self.require_topic(topic_id)?;
        if body.len() > 100_000 {
            return Err(invalid("Notes must be under 100,000 bytes."));
        }
        let tx = self.conn.transaction()?;
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
        let timestamp = now();
        // Serialize the replay check with the award, including across app instances.
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
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
            });
        }
        let xp_awarded = if passed {
            award(&tx, &format!("quiz-pass:{topic_id}"), 100, &timestamp)?
        } else {
            0
        };
        tx.execute("INSERT INTO quiz_attempts(attempt_id,topic_id,answers_json,score,total,passed,xp_awarded,feedback_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![attempt_id,topic_id,answers_json,score,total,passed,xp_awarded,serde_json::to_string(&feedback)?,timestamp])?;
        tx.execute("UPDATE topic_progress SET mastery=CASE WHEN mastery='passed' OR ?2 THEN 'passed' ELSE 'needs_review' END,best_score=MAX(COALESCE(best_score,0),?3),last_studied_at=?4 WHERE topic_id=?1",params![topic_id,passed,percentage,timestamp])?;
        if passed {
            tx.execute("INSERT OR IGNORE INTO achievements(id,title,earned_at) VALUES('first-mastery','First Mastery',?1)",[&timestamp])?;
        }
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
        })
    }
    pub fn import_book_pdf(
        &mut self,
        book_id: &str,
        file_name: &str,
        bytes: &[u8],
    ) -> Result<BookDocument> {
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
        self.conn.execute("INSERT INTO book_documents(book_id,file_name,imported_at,bytes) VALUES(?1,?2,?3,?4) ON CONFLICT(book_id) DO UPDATE SET file_name=excluded.file_name,imported_at=excluded.imported_at,bytes=excluded.bytes",params![book_id,file_name,imported_at,bytes])?;
        Ok(BookDocument {
            book_id: book_id.into(),
            file_name: file_name.into(),
            imported_at,
        })
    }
    pub fn get_book_document(&self, book_id: &str) -> Result<Option<BookDocument>> {
        self.require_book(book_id)?;
        Ok(self
            .conn
            .query_row(
                "SELECT book_id,file_name,imported_at FROM book_documents WHERE book_id=?1",
                [book_id],
                |r| {
                    Ok(BookDocument {
                        book_id: r.get(0)?,
                        file_name: r.get(1)?,
                        imported_at: r.get(2)?,
                    })
                },
            )
            .optional()?)
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
        assert_eq!(topic.mastery, "passed");
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
        assert_eq!(version, 1);
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
