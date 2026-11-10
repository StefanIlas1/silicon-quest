use crate::store::{AppError, Result};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{fs::File, path::Path, time::Instant};

fn error(code: &'static str, message: &str) -> AppError {
    AppError {
        code,
        message: message.into(),
    }
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSession {
    pub id: String,
    pub topic_id: String,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub updated_at: String,
    pub elapsed_seconds: i64,
    pub sequence: i64,
    pub excluded_gap_count: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicTime {
    pub topic_id: String,
    pub seconds: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSummary {
    pub active_session: Option<FocusSession>,
    pub sessions: Vec<FocusSession>,
    pub total_seconds: i64,
    pub completed_sessions: i64,
    pub interrupted_sessions: i64,
    pub today_seconds: i64,
    pub today_date: String,
    pub topic_seconds: Vec<TopicTime>,
    pub can_control: bool,
}
struct ClockSample {
    instant: Instant,
    wall: DateTime<Utc>,
}
impl ClockSample {
    fn now() -> Self {
        Self {
            instant: Instant::now(),
            wall: Utc::now(),
        }
    }
}
struct ActiveClock {
    id: String,
    sample: ClockSample,
}
pub struct FocusRuntime {
    _lock: Option<File>,
    can_control: bool,
    token: String,
    clock: Option<ActiveClock>,
}
impl FocusRuntime {
    pub fn lock(path: &Path) -> Result<(Option<File>, bool)> {
        let mut name = path
            .canonicalize()
            .map_err(|_| {
                error(
                    "storage_error",
                    "Could not locate the local focus database.",
                )
            })?
            .into_os_string();
        name.push(".focus-lock");
        let mut options = File::options();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(name).map_err(|_| {
            error(
                "storage_error",
                "Could not open the private focus ownership lock.",
            )
        })?;
        match file.try_lock() {
            Ok(()) => Ok((Some(file), true)),
            Err(std::fs::TryLockError::WouldBlock) => Ok((None, false)),
            Err(_) => Err(error(
                "storage_error",
                "Could not lock local focus tracking. Restart the app to try again.",
            )),
        }
    }
    pub fn initialize(conn: &Connection, lock: Option<File>, can_control: bool) -> Result<Self> {
        let token: String =
            conn.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
        if can_control {
            // Only an exclusive lock owner may recover a previous process. Never
            // infer elapsed time from wall timestamps or startup time.
            conn.execute("UPDATE focus_sessions SET status='interrupted',ended_at=updated_at WHERE status='active'",[])?;
        }
        Ok(Self {
            _lock: lock,
            can_control,
            token,
            clock: None,
        })
    }
    fn require_owner(&self) -> Result<()> {
        if !self.can_control {
            return Err(error("focus_owned_elsewhere","Focus tracking is controlled by another app window. Close the other instance and restart this one to track time here."));
        }
        Ok(())
    }
}
const SESSION_FIELDS: &str =
    "id,topic_id,status,started_at,ended_at,updated_at,elapsed_ms/1000,sequence,excluded_gaps";
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<FocusSession> {
    Ok(FocusSession {
        id: r.get(0)?,
        topic_id: r.get(1)?,
        status: r.get(2)?,
        started_at: r.get(3)?,
        ended_at: r.get(4)?,
        updated_at: r.get(5)?,
        elapsed_seconds: r.get(6)?,
        sequence: r.get(7)?,
        excluded_gap_count: r.get(8)?,
    })
}
pub fn summary(conn: &Connection, runtime: &FocusRuntime) -> Result<FocusSummary> {
    let tx = conn.unchecked_transaction()?;
    let active_session = tx
        .query_row(
            &format!("SELECT {SESSION_FIELDS} FROM focus_sessions WHERE status='active'"),
            [],
            row,
        )
        .optional()?;
    let sessions=tx.prepare(&format!("SELECT {SESSION_FIELDS} FROM focus_sessions ORDER BY started_at DESC,rowid DESC LIMIT 100"))?.query_map([],row)?.collect::<std::result::Result<Vec<_>,_>>()?;
    let (total_seconds,completed_sessions,interrupted_sessions)=tx.query_row("SELECT COALESCE(SUM(elapsed_ms),0)/1000,COALESCE(SUM(status='completed'),0),COALESCE(SUM(status='interrupted'),0) FROM focus_sessions",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
    let today_date = Utc::now().date_naive().to_string();
    let today_seconds = tx.query_row(
        "SELECT COALESCE(SUM(elapsed_ms),0)/1000 FROM focus_daily WHERE day=?1",
        [&today_date],
        |r| r.get(0),
    )?;
    let topic_seconds=tx.prepare("SELECT topic_id,SUM(elapsed_ms)/1000 FROM focus_sessions GROUP BY topic_id ORDER BY SUM(elapsed_ms) DESC,topic_id")?.query_map([],|r|Ok(TopicTime {topic_id:r.get(0)?,seconds:r.get(1)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
    tx.commit()?;
    Ok(FocusSummary {
        active_session,
        sessions,
        total_seconds,
        completed_sessions,
        interrupted_sessions,
        today_seconds,
        today_date,
        topic_seconds,
        can_control: runtime.can_control,
    })
}
pub fn start(
    conn: &mut Connection,
    runtime: &mut FocusRuntime,
    topic_id: &str,
    request_id: &str,
) -> Result<FocusSummary> {
    start_at(conn, runtime, topic_id, request_id, ClockSample::now())
}
fn start_at(
    conn: &mut Connection,
    runtime: &mut FocusRuntime,
    topic_id: &str,
    request_id: &str,
    sample: ClockSample,
) -> Result<FocusSummary> {
    runtime.require_owner()?;
    if request_id.len() < 8
        || request_id.len() > 128
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(error(
            "invalid_input",
            "Use a unique focus request ID of 8–128 letters, digits, hyphens or underscores.",
        ));
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing: Option<String> = tx
        .query_row(
            "SELECT topic_id FROM focus_sessions WHERE id=?1",
            [request_id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(old_topic) = existing {
        if old_topic != topic_id {
            return Err(error(
                "invalid_input",
                "This focus request ID was already used for a different topic.",
            ));
        }
        tx.commit()?;
        return summary(conn, runtime);
    }
    let has_active = tx
        .query_row(
            "SELECT 1 FROM focus_sessions WHERE status='active'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if has_active {
        return Err(error(
            "active_session_exists",
            "Finish the active focus session before starting another.",
        ));
    }
    let timestamp = sample.wall.to_rfc3339();
    tx.execute("INSERT INTO focus_sessions(id,topic_id,owner_token,status,started_at,updated_at) VALUES(?1,?2,?3,'active',?4,?4)",params![request_id,topic_id,runtime.token,timestamp])?;
    tx.commit()?;
    runtime.clock = Some(ActiveClock {
        id: request_id.into(),
        sample,
    });
    summary(conn, runtime)
}
pub fn tick(
    conn: &mut Connection,
    runtime: &mut FocusRuntime,
    session_id: &str,
    sequence: i64,
    end: bool,
) -> Result<FocusSummary> {
    tick_at(conn, runtime, session_id, sequence, end, ClockSample::now())
}
fn tick_at(
    conn: &mut Connection,
    runtime: &mut FocusRuntime,
    session_id: &str,
    sequence: i64,
    end: bool,
    sample: ClockSample,
) -> Result<FocusSummary> {
    runtime.require_owner()?;
    if session_id.len() < 8
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(error("invalid_input", "Invalid focus session ID."));
    }
    if sequence < 1 {
        return Err(error(
            "invalid_input",
            "Focus checkpoint sequence must be a positive integer.",
        ));
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let stored: Option<(String, String, i64)> = tx
        .query_row(
            "SELECT status,owner_token,sequence FROM focus_sessions WHERE id=?1",
            [session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((status, owner, stored_sequence)) = stored else {
        return Err(error("invalid_input", "Unknown focus session."));
    };
    if status != "active" || sequence <= stored_sequence {
        tx.commit()?;
        return summary(conn, runtime);
    }
    if owner != runtime.token {
        return Err(error(
            "stale_session",
            "This focus session belongs to a previous app run. Refresh the session log.",
        ));
    }
    if Some(sequence) != stored_sequence.checked_add(1) {
        return Err(error(
            "invalid_sequence",
            "Refresh focus tracking before sending the next checkpoint.",
        ));
    }
    let clock=runtime.clock.as_ref().filter(|c|c.id==session_id).ok_or_else(||error("stale_session","The focus timer lost its local clock. Restart the app to recover its last saved checkpoint."))?;
    let delta = sample.instant.checked_duration_since(clock.sample.instant);
    let wall_ms = (sample.wall - clock.sample.wall).num_milliseconds();
    let monotonic_ms = delta
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(-1);
    // Long heartbeats, sleep, backwards clocks and significant clock jumps
    // restart the anchor with zero credit. Fractional seconds remain durable.
    let excluded = !(0..=30_000).contains(&monotonic_ms)
        || !(0..=30_000).contains(&wall_ms)
        || monotonic_ms.abs_diff(wall_ms) > 2_000;
    let credited = if excluded { 0 } else { monotonic_ms };
    let timestamp = sample.wall.to_rfc3339();
    tx.execute("UPDATE focus_sessions SET elapsed_ms=elapsed_ms+?2,sequence=?3,excluded_gaps=excluded_gaps+?4,status=?5,updated_at=?6,ended_at=?7 WHERE id=?1 AND owner_token=?8 AND status='active'",params![session_id,credited,sequence,i64::from(excluded),if end {"completed"} else {"active"},timestamp,if end {Some(&timestamp)} else {None},runtime.token])?;
    if credited > 0 {
        // Daily totals are assigned to the accepted checkpoint's UTC date.
        tx.execute("INSERT INTO focus_daily(session_id,day,elapsed_ms) VALUES(?1,?2,?3) ON CONFLICT(session_id,day) DO UPDATE SET elapsed_ms=elapsed_ms+excluded.elapsed_ms",params![session_id,sample.wall.date_naive().to_string(),credited])?;
    }
    tx.commit()?;
    runtime.clock = if end {
        None
    } else {
        Some(ActiveClock {
            id: session_id.into(),
            sample,
        })
    };
    summary(conn, runtime)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    fn database() -> (Connection, FocusRuntime) {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn);
        let runtime = FocusRuntime::initialize(&conn, None, true).unwrap();
        (conn, runtime)
    }
    fn schema(conn: &Connection) {
        conn.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE topics(id TEXT PRIMARY KEY); INSERT INTO topics(id) VALUES('cache-locality'),('cuda-memory');").unwrap();
        conn.execute_batch(include_str!("../migrations/003_focus_sessions.sql"))
            .unwrap();
    }
    fn sample(base: Instant, ms: u64) -> ClockSample {
        ClockSample {
            instant: base + Duration::from_millis(ms),
            wall: DateTime::parse_from_rfc3339("2026-11-10T23:59:50Z")
                .unwrap()
                .with_timezone(&Utc)
                + chrono::Duration::milliseconds(ms as i64),
        }
    }
    #[test]
    fn start_replays_keep_the_original_clock_and_only_one_session_is_active() {
        let (mut conn, mut runtime) = database();
        let base = Instant::now();
        start_at(
            &mut conn,
            &mut runtime,
            "cache-locality",
            "focus-0001",
            sample(base, 0),
        )
        .unwrap();
        start_at(
            &mut conn,
            &mut runtime,
            "cache-locality",
            "focus-0001",
            sample(base, 5000),
        )
        .unwrap();
        assert!(start_at(
            &mut conn,
            &mut runtime,
            "cuda-memory",
            "focus-0001",
            sample(base, 5000)
        )
        .is_err());
        assert_eq!(
            start_at(
                &mut conn,
                &mut runtime,
                "cuda-memory",
                "focus-0002",
                sample(base, 5000)
            )
            .unwrap_err()
            .code,
            "active_session_exists"
        );
        let state = tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            1,
            false,
            sample(base, 10_000),
        )
        .unwrap();
        assert_eq!(state.active_session.unwrap().elapsed_seconds, 10);
        assert_eq!(state.sessions.len(), 1);
    }
    #[test]
    fn subsecond_checkpoints_and_replays_do_not_lose_or_duplicate_time() {
        let (mut conn, mut runtime) = database();
        let base = Instant::now();
        start_at(
            &mut conn,
            &mut runtime,
            "cache-locality",
            "focus-0001",
            sample(base, 0),
        )
        .unwrap();
        tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            1,
            false,
            sample(base, 500),
        )
        .unwrap();
        let replay = tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            1,
            false,
            sample(base, 20_000),
        )
        .unwrap();
        assert_eq!(replay.active_session.unwrap().sequence, 1);
        let second = tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            2,
            false,
            sample(base, 1000),
        )
        .unwrap();
        assert_eq!(second.total_seconds, 1);
        let end = tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            3,
            true,
            sample(base, 1500),
        )
        .unwrap();
        assert!(end.active_session.is_none());
        assert_eq!(end.completed_sessions, 1);
        assert_eq!(end.total_seconds, 1);
        let replay = tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            3,
            true,
            sample(base, 800_000),
        )
        .unwrap();
        assert_eq!(replay.total_seconds, 1);
        let ms: i64 = conn
            .query_row("SELECT elapsed_ms FROM focus_sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ms, 1500);
    }
    #[test]
    fn long_gaps_sleep_and_clock_changes_are_excluded_then_tracking_resumes() {
        let (mut conn, mut runtime) = database();
        let base = Instant::now();
        start_at(
            &mut conn,
            &mut runtime,
            "cache-locality",
            "focus-0001",
            sample(base, 0),
        )
        .unwrap();
        tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            1,
            false,
            sample(base, 10_000),
        )
        .unwrap();
        let long = tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            2,
            false,
            sample(base, 70_000),
        )
        .unwrap();
        assert_eq!(long.total_seconds, 10);
        assert_eq!(long.active_session.unwrap().excluded_gap_count, 1);
        let mut sleep = sample(base, 80_000);
        sleep.wall += chrono::Duration::hours(1);
        tick_at(&mut conn, &mut runtime, "focus-0001", 3, false, sleep).unwrap();
        let mut back = sample(base, 90_000);
        back.wall -= chrono::Duration::hours(1);
        let state = tick_at(&mut conn, &mut runtime, "focus-0001", 4, false, back).unwrap();
        assert_eq!(state.total_seconds, 10);
        assert_eq!(state.active_session.unwrap().excluded_gap_count, 3);
        let mut resumed = sample(base, 100_000);
        resumed.wall -= chrono::Duration::hours(1);
        let state = tick_at(&mut conn, &mut runtime, "focus-0001", 5, true, resumed).unwrap();
        assert_eq!(state.total_seconds, 20);
        assert_eq!(state.completed_sessions, 1);
    }
    #[test]
    fn invalid_sequences_and_unknown_sessions_leave_clock_and_database_unchanged() {
        let (mut conn, mut runtime) = database();
        let base = Instant::now();
        assert!(start_at(
            &mut conn,
            &mut runtime,
            "cache-locality",
            "bad",
            sample(base, 0)
        )
        .is_err());
        start_at(
            &mut conn,
            &mut runtime,
            "cache-locality",
            "focus-0001",
            sample(base, 0),
        )
        .unwrap();
        assert!(tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            0,
            false,
            sample(base, 1000)
        )
        .is_err());
        assert_eq!(
            tick_at(
                &mut conn,
                &mut runtime,
                "focus-0001",
                3,
                false,
                sample(base, 1000)
            )
            .unwrap_err()
            .code,
            "invalid_sequence"
        );
        assert!(tick_at(
            &mut conn,
            &mut runtime,
            "not-found",
            1,
            false,
            sample(base, 1000)
        )
        .is_err());
        let state = tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            1,
            false,
            sample(base, 2000),
        )
        .unwrap();
        assert_eq!(state.total_seconds, 2);
        assert_eq!(state.active_session.unwrap().sequence, 1);
    }
    #[test]
    fn owner_lock_preserves_live_sessions_and_restart_recovers_only_saved_time() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("focus.sqlite3");
        let mut first = Connection::open(&path).unwrap();
        schema(&first);
        let (lock, owner) = FocusRuntime::lock(&path).unwrap();
        assert!(owner);
        let mut runtime = FocusRuntime::initialize(&first, lock, owner).unwrap();
        let base = Instant::now();
        start_at(
            &mut first,
            &mut runtime,
            "cache-locality",
            "focus-0001",
            sample(base, 0),
        )
        .unwrap();
        tick_at(
            &mut first,
            &mut runtime,
            "focus-0001",
            1,
            false,
            sample(base, 12_000),
        )
        .unwrap();
        let mut observer = Connection::open(&path).unwrap();
        let (lock, owner) = FocusRuntime::lock(&path).unwrap();
        assert!(!owner);
        let mut observer_runtime = FocusRuntime::initialize(&observer, lock, owner).unwrap();
        let state = summary(&observer, &observer_runtime).unwrap();
        assert!(!state.can_control);
        assert_eq!(state.active_session.unwrap().elapsed_seconds, 12);
        assert_eq!(
            tick_at(
                &mut observer,
                &mut observer_runtime,
                "focus-0001",
                2,
                true,
                sample(base, 20_000)
            )
            .unwrap_err()
            .code,
            "focus_owned_elsewhere"
        );
        drop(runtime);
        drop(first);
        let (lock, owner) = FocusRuntime::lock(&path).unwrap();
        assert!(owner);
        let recovered_runtime = FocusRuntime::initialize(&observer, lock, owner).unwrap();
        let state = summary(&observer, &recovered_runtime).unwrap();
        assert!(state.active_session.is_none());
        assert_eq!(state.total_seconds, 12);
        assert_eq!(state.interrupted_sessions, 1);
        assert_eq!(
            state.sessions[0].ended_at.as_deref(),
            Some(state.sessions[0].updated_at.as_str())
        );
        assert_eq!(state.sessions[0].status, "interrupted");
    }
    #[test]
    fn aggregates_cover_all_sessions_beyond_history_limit_without_double_count() {
        let (mut conn, mut runtime) = database();
        let base = Instant::now();
        for index in 0..105 {
            let id = format!("focus-{index:04}");
            let offset = index * 2000;
            start_at(
                &mut conn,
                &mut runtime,
                if index % 2 == 0 {
                    "cache-locality"
                } else {
                    "cuda-memory"
                },
                &id,
                sample(base, offset),
            )
            .unwrap();
            tick_at(
                &mut conn,
                &mut runtime,
                &id,
                1,
                true,
                sample(base, offset + 1000),
            )
            .unwrap();
        }
        let state = summary(&conn, &runtime).unwrap();
        assert_eq!(state.sessions.len(), 100);
        assert_eq!(state.total_seconds, 105);
        assert_eq!(state.completed_sessions, 105);
        assert_eq!(
            state.topic_seconds.iter().map(|t| t.seconds).sum::<i64>(),
            105
        );
        let daily: i64 = conn
            .query_row("SELECT SUM(elapsed_ms)/1000 FROM focus_daily", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(daily, 105);
    }
    #[test]
    fn utc_daily_totals_use_the_checkpoint_day_and_match_durable_elapsed() {
        let (mut conn, mut runtime) = database();
        let base = Instant::now();
        start_at(
            &mut conn,
            &mut runtime,
            "cache-locality",
            "focus-0001",
            sample(base, 0),
        )
        .unwrap();
        tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            1,
            false,
            sample(base, 5000),
        )
        .unwrap();
        tick_at(
            &mut conn,
            &mut runtime,
            "focus-0001",
            2,
            true,
            sample(base, 15_000),
        )
        .unwrap();
        let mut statement = conn
            .prepare("SELECT day,elapsed_ms FROM focus_daily ORDER BY day")
            .unwrap();
        let days = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            days,
            vec![("2026-11-10".into(), 5000), ("2026-11-11".into(), 10000)]
        );
    }
}
