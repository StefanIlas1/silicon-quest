use crate::store::{AppError, Result};
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
const INTERVALS: [i64; 5] = [1, 3, 7, 14, 30];
const EVIDENCE_REQUIRED: i64 = 3;
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledReview {
    pub topic_id: String,
    pub stage: String,
    pub successful_reviews: i64,
    pub due_at: String,
    pub interval_days: i64,
    pub last_attempt_at: String,
    pub last_qualified_at: Option<String>,
    pub lapse_count: i64,
    pub due: bool,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReviewEvent {
    pub attempt_id: String,
    pub topic_id: String,
    pub passed: bool,
    pub qualified: bool,
    pub reason: String,
    pub created_at: String,
    pub stage_after: String,
    pub successful_reviews_after: i64,
    pub due_at_after: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSummary {
    pub as_of: String,
    pub due: Vec<ScheduledReview>,
    pub upcoming: Vec<ScheduledReview>,
    pub mastered_count: i64,
    pub total_scheduled: i64,
    pub evidence_required: i64,
    pub interval_days: [i64; 5],
    pub policy_version: i64,
    pub events: Vec<ReviewEvent>,
}
fn parse(timestamp: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(timestamp)
        .map(|t| t.with_timezone(&Utc))
        .map_err(|_| AppError {
            code: "data_error",
            message: "A saved quiz timestamp could not be read; existing records were preserved."
                .into(),
        })
}
fn checked_due(now: DateTime<Utc>, days: i64) -> Result<String> {
    now.checked_add_signed(Duration::days(days))
        .map(|d| d.to_rfc3339())
        .ok_or_else(|| AppError {
            code: "data_error",
            message: "The quiz timestamp is outside the supported scheduling range.".into(),
        })
}
fn schedule_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ScheduledReview> {
    Ok(ScheduledReview {
        topic_id: r.get(0)?,
        stage: r.get(1)?,
        successful_reviews: r.get(2)?,
        due_at: r.get(3)?,
        interval_days: r.get(4)?,
        last_attempt_at: r.get(5)?,
        last_qualified_at: r.get(6)?,
        lapse_count: r.get(7)?,
        due: false,
    })
}
fn event_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ReviewEvent> {
    Ok(ReviewEvent {
        attempt_id: r.get(0)?,
        topic_id: r.get(1)?,
        passed: r.get(2)?,
        qualified: r.get(3)?,
        reason: r.get(4)?,
        created_at: r.get(5)?,
        stage_after: r.get(6)?,
        successful_reviews_after: r.get(7)?,
        due_at_after: r.get(8)?,
    })
}
const SCHEDULE_FIELDS:&str="topic_id,stage,successful_reviews,due_at,interval_days,last_attempt_at,last_qualified_at,lapse_count";
const EVENT_FIELDS:&str="attempt_id,topic_id,passed,qualified,reason,created_at,stage_after,successful_reviews_after,due_at_after";
pub fn event(conn: &Connection, attempt_id: &str) -> Result<ReviewEvent> {
    Ok(conn.query_row(
        &format!("SELECT {EVENT_FIELDS} FROM review_events WHERE attempt_id=?1"),
        [attempt_id],
        event_row,
    )?)
}
fn transition(
    previous: Option<ScheduledReview>,
    topic_id: &str,
    passed: bool,
    at: DateTime<Utc>,
) -> Result<(ScheduledReview, bool, &'static str)> {
    let timestamp = at.to_rfc3339();
    let first = previous.is_none();
    let mut state = previous.unwrap_or(ScheduledReview {
        topic_id: topic_id.into(),
        stage: "learning".into(),
        successful_reviews: 0,
        due_at: timestamp.clone(),
        interval_days: 1,
        last_attempt_at: timestamp.clone(),
        last_qualified_at: None,
        lapse_count: 0,
        due: false,
    });
    state.last_attempt_at = timestamp.clone();
    let (qualified, reason) = if !passed {
        state.stage = "needs_review".into();
        state.successful_reviews = 0;
        state.interval_days = 1;
        state.lapse_count += 1;
        let next = checked_due(at, 1)?;
        // Early failed practice may shorten a distant due date, but cannot keep
        // postponing a review that was already due sooner.
        if first || parse(&state.due_at)? <= at || parse(&state.due_at)? > parse(&next)? {
            state.due_at = next;
        }
        (false, "failed_check")
    } else if first || at >= parse(&state.due_at)? {
        state.successful_reviews += 1;
        state.stage = if state.successful_reviews >= EVIDENCE_REQUIRED {
            "mastered"
        } else {
            "learning"
        }
        .into();
        let index = (state.successful_reviews - 1).min((INTERVALS.len() - 1) as i64) as usize;
        state.interval_days = INTERVALS[index];
        state.due_at = checked_due(at, state.interval_days)?;
        state.last_qualified_at = Some(timestamp);
        (
            true,
            if first {
                "first_pass"
            } else {
                "scheduled_pass"
            },
        )
    } else {
        (false, "early_practice")
    };
    state.due = parse(&state.due_at)? <= at;
    Ok((state, qualified, reason))
}
pub fn apply_attempt(tx: &Transaction<'_>, attempt_id: &str) -> Result<ReviewEvent> {
    if let Some(existing) = tx
        .query_row(
            &format!("SELECT {EVENT_FIELDS} FROM review_events WHERE attempt_id=?1"),
            [attempt_id],
            event_row,
        )
        .optional()?
    {
        return Ok(existing);
    }
    // Only an existing authoritative grade can create scheduling evidence.
    let (topic_id, passed, timestamp): (String, bool, String) = tx.query_row(
        "SELECT topic_id,passed,created_at FROM quiz_attempts WHERE attempt_id=?1",
        [attempt_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let previous = tx
        .query_row(
            &format!("SELECT {SCHEDULE_FIELDS} FROM review_schedule WHERE topic_id=?1"),
            [&topic_id],
            schedule_row,
        )
        .optional()?;
    let (state, qualified, reason) = transition(previous, &topic_id, passed, parse(&timestamp)?)?;
    tx.execute("INSERT INTO review_schedule(topic_id,stage,successful_reviews,due_at,interval_days,last_attempt_at,last_qualified_at,lapse_count) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(topic_id) DO UPDATE SET stage=excluded.stage,successful_reviews=excluded.successful_reviews,due_at=excluded.due_at,interval_days=excluded.interval_days,last_attempt_at=excluded.last_attempt_at,last_qualified_at=excluded.last_qualified_at,lapse_count=excluded.lapse_count",params![state.topic_id,state.stage,state.successful_reviews,state.due_at,state.interval_days,state.last_attempt_at,state.last_qualified_at,state.lapse_count])?;
    let result = ReviewEvent {
        attempt_id: attempt_id.into(),
        topic_id,
        passed,
        qualified,
        reason: reason.into(),
        created_at: parse(&timestamp)?.to_rfc3339(),
        stage_after: state.stage,
        successful_reviews_after: state.successful_reviews,
        due_at_after: state.due_at,
    };
    tx.execute("INSERT INTO review_events(attempt_id,topic_id,passed,qualified,reason,created_at,stage_after,successful_reviews_after,due_at_after) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![result.attempt_id,result.topic_id,result.passed,result.qualified,result.reason,result.created_at,result.stage_after,result.successful_reviews_after,result.due_at_after])?;
    tx.execute(
        "UPDATE topic_progress SET mastery=?2 WHERE topic_id=?1",
        params![
            result.topic_id,
            if passed { "passed" } else { "needs_review" }
        ],
    )?;
    if result.stage_after == "mastered" {
        tx.execute("INSERT OR IGNORE INTO achievements(id,title,earned_at) VALUES('spaced-mastery','Spaced Recall',?1)",[&result.created_at])?;
    }
    Ok(result)
}
pub fn backfill(tx: &Transaction<'_>) -> Result<()> {
    let attempts = tx
        .prepare("SELECT attempt_id,created_at,rowid FROM quiz_attempts")?
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut ordered = attempts
        .into_iter()
        .map(|(id, time, rowid)| Ok((parse(&time)?, rowid, id)))
        .collect::<Result<Vec<_>>>()?;
    ordered.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    for (_, _, id) in ordered {
        apply_attempt(tx, &id)?;
    }

    Ok(())
}
pub fn summary(conn: &Connection) -> Result<ReviewSummary> {
    summary_at(conn, Utc::now())
}
fn summary_at(conn: &Connection, at: DateTime<Utc>) -> Result<ReviewSummary> {
    let tx = conn.unchecked_transaction()?;
    let mut scheduled = tx
        .prepare(&format!(
            "SELECT {SCHEDULE_FIELDS} FROM review_schedule ORDER BY due_at,topic_id"
        ))?
        .query_map([], schedule_row)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for state in &mut scheduled {
        state.due = parse(&state.due_at)? <= at;
    }
    let mastered_count = scheduled.iter().filter(|s| s.stage == "mastered").count() as i64;
    let total_scheduled = scheduled.len() as i64;
    let (due, upcoming) = scheduled.into_iter().partition(|s| s.due);
    let events=tx.prepare(&format!("SELECT {EVENT_FIELDS} FROM review_events ORDER BY created_at DESC,rowid DESC LIMIT 100"))?.query_map([],event_row)?.collect::<std::result::Result<Vec<_>,_>>()?;
    tx.commit()?;
    Ok(ReviewSummary {
        as_of: at.to_rfc3339(),
        due,
        upcoming,
        mastered_count,
        total_scheduled,
        evidence_required: EVIDENCE_REQUIRED,
        interval_days: INTERVALS,
        policy_version: 1,
        events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn time(value: &str) -> DateTime<Utc> {
        parse(value).unwrap()
    }
    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(include_str!("../migrations/001_initial.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../migrations/004_spaced_review.sql"))
            .unwrap();
        conn.execute(
            "INSERT INTO books(id,title,metadata_json) VALUES('csapp','CSAPP','{}')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO topics(id,book_id,title,metadata_json) VALUES('cache-locality','csapp','Caches','{}')",[]).unwrap();
        conn.execute(
            "INSERT INTO topic_progress(topic_id) VALUES('cache-locality')",
            [],
        )
        .unwrap();
        conn
    }
    fn insert_attempt(conn: &Connection, id: &str, passed: bool, timestamp: &str) {
        conn.execute("INSERT INTO quiz_attempts(attempt_id,topic_id,answers_json,score,total,passed,xp_awarded,feedback_json,created_at) VALUES(?1,'cache-locality','[]',?2,1,?2,0,'[]',?3)",params![id,passed,timestamp]).unwrap();
    }
    fn record(conn: &mut Connection, id: &str, passed: bool, timestamp: &str) -> ReviewEvent {
        let tx = conn.transaction().unwrap();
        insert_attempt(&tx, id, passed, timestamp);
        let result = apply_attempt(&tx, id).unwrap();
        tx.commit().unwrap();
        result
    }
    #[test]
    fn three_spaced_passes_are_required_and_boundary_is_exact() {
        let (first, q, _) =
            transition(None, "cache-locality", true, time("2026-11-10T10:00:00Z")).unwrap();
        assert!(q);
        assert_eq!(first.stage, "learning");
        assert_eq!(first.successful_reviews, 1);
        assert_eq!(first.due_at, "2026-11-11T10:00:00+00:00");
        let (early, q, reason) = transition(
            Some(first.clone()),
            "cache-locality",
            true,
            time("2026-11-11T09:59:59.999Z"),
        )
        .unwrap();
        assert!(!q);
        assert_eq!(reason, "early_practice");
        assert_eq!(early.successful_reviews, 1);
        assert_eq!(early.due_at, first.due_at);
        let (second, q, _) = transition(
            Some(early),
            "cache-locality",
            true,
            time("2026-11-11T10:00:00Z"),
        )
        .unwrap();
        assert!(q);
        assert_eq!(second.successful_reviews, 2);
        assert_eq!(second.stage, "learning");
        assert_eq!(second.due_at, "2026-11-14T10:00:00+00:00");
        let (third, q, _) = transition(
            Some(second),
            "cache-locality",
            true,
            time("2026-11-14T10:00:00Z"),
        )
        .unwrap();
        assert!(q);
        assert_eq!(third.stage, "mastered");
        assert_eq!(third.successful_reviews, 3);
        assert_eq!(third.interval_days, 7);
    }
    #[test]
    fn repeated_same_day_practice_cannot_promote_or_postpone_due_date() {
        let (mut state, _, _) =
            transition(None, "cache-locality", true, time("2026-11-10T10:00:00Z")).unwrap();
        let due = state.due_at.clone();
        for minute in 1..100 {
            let (updated, qualified, reason) = transition(
                Some(state),
                "cache-locality",
                true,
                time("2026-11-10T10:00:00Z") + Duration::minutes(minute),
            )
            .unwrap();
            assert!(!qualified);
            assert_eq!(reason, "early_practice");
            state = updated;
        }
        assert_eq!(state.successful_reviews, 1);
        assert_eq!(state.stage, "learning");
        assert_eq!(state.due_at, due);
    }
    #[test]
    fn failure_demotes_mastery_and_early_retries_do_not_delay_a_sooner_review() {
        let (first, _, _) =
            transition(None, "cache-locality", true, time("2026-11-10T10:00:00Z")).unwrap();
        let (second, _, _) = transition(
            Some(first),
            "cache-locality",
            true,
            time("2026-11-11T10:00:00Z"),
        )
        .unwrap();
        let (mastered, _, _) = transition(
            Some(second),
            "cache-locality",
            true,
            time("2026-11-14T10:00:00Z"),
        )
        .unwrap();
        let (failed, qualified, reason) = transition(
            Some(mastered),
            "cache-locality",
            false,
            time("2026-11-14T11:00:00Z"),
        )
        .unwrap();
        assert!(!qualified);
        assert_eq!(reason, "failed_check");
        assert_eq!(failed.stage, "needs_review");
        assert_eq!(failed.successful_reviews, 0);
        assert_eq!(failed.lapse_count, 1);
        assert_eq!(failed.due_at, "2026-11-15T11:00:00+00:00");
        let (failed_again, _, _) = transition(
            Some(failed.clone()),
            "cache-locality",
            false,
            time("2026-11-14T12:00:00Z"),
        )
        .unwrap();
        assert_eq!(failed_again.due_at, failed.due_at);
        assert_eq!(failed_again.lapse_count, 2);
        let (early_pass, q, _) = transition(
            Some(failed_again),
            "cache-locality",
            true,
            time("2026-11-14T13:00:00Z"),
        )
        .unwrap();
        assert!(!q);
        assert_eq!(early_pass.stage, "needs_review");
        assert_eq!(early_pass.successful_reviews, 0);
        let (restarted, q, _) = transition(
            Some(early_pass),
            "cache-locality",
            true,
            time("2026-11-15T11:00:00Z"),
        )
        .unwrap();
        assert!(q);
        assert_eq!(restarted.stage, "learning");
        assert_eq!(restarted.successful_reviews, 1);
    }
    #[test]
    fn first_failure_schedules_review_and_late_failure_restarts_one_day_interval() {
        let (first, _, _) =
            transition(None, "cache-locality", false, time("2026-11-10T10:00:00Z")).unwrap();
        assert_eq!(first.stage, "needs_review");
        assert_eq!(first.successful_reviews, 0);
        assert_eq!(first.due_at, "2026-11-11T10:00:00+00:00");
        let (late, _, _) = transition(
            Some(first),
            "cache-locality",
            false,
            time("2026-11-20T10:00:00Z"),
        )
        .unwrap();
        assert_eq!(late.due_at, "2026-11-21T10:00:00+00:00");
    }
    #[test]
    fn later_intervals_cap_at_thirty_days_without_skipping_evidence() {
        let (mut state, _, _) =
            transition(None, "cache-locality", true, time("2026-11-10T10:00:00Z")).unwrap();
        let mut intervals = vec![state.interval_days];
        for _ in 0..7 {
            let at = parse(&state.due_at).unwrap();
            let (next, q, _) = transition(Some(state), "cache-locality", true, at).unwrap();
            assert!(q);
            intervals.push(next.interval_days);
            state = next;
        }
        assert_eq!(intervals, vec![1, 3, 7, 14, 30, 30, 30, 30]);
        assert_eq!(state.successful_reviews, 8);
    }
    #[test]
    fn applying_one_attempt_twice_is_idempotent_and_due_summary_never_mutates() {
        let mut conn = database();
        let first = record(&mut conn, "attempt-0001", true, "2026-11-10T10:00:00Z");
        let tx = conn.transaction().unwrap();
        let replay = apply_attempt(&tx, "attempt-0001").unwrap();
        tx.commit().unwrap();
        assert_eq!(replay.due_at_after, first.due_at_after);
        let before = summary_at(&conn, time("2026-11-11T09:59:59Z")).unwrap();
        assert!(before.due.is_empty());
        assert_eq!(before.upcoming.len(), 1);
        assert_eq!(before.mastered_count, 0);
        let due = summary_at(&conn, time("2026-11-11T10:00:00Z")).unwrap();
        assert_eq!(due.due.len(), 1);
        assert!(due.upcoming.is_empty());
        assert_eq!(due.events.len(), 1);
        assert_eq!(due.due[0].successful_reviews, 1);
        assert_eq!(
            summary_at(&conn, time("2026-12-11T10:00:00Z"))
                .unwrap()
                .mastered_count,
            0
        );
    }
    #[test]
    fn replay_backfill_orders_real_timestamps_and_rowid_ties_and_keeps_raw_history() {
        let mut conn = database();
        // Lexical order differs from actual UTC order: this pass is at 06:00Z.
        insert_attempt(&conn, "attempt-first", true, "2026-11-10T10:00:00+04:00");
        insert_attempt(&conn, "attempt-second", false, "2026-11-10T07:00:00Z");
        // Exact tie: later inserted pass is latest, but cannot promote before due.
        insert_attempt(&conn, "attempt-third", true, "2026-11-10T07:00:00Z");
        let tx = conn.transaction().unwrap();
        backfill(&tx).unwrap();
        tx.commit().unwrap();
        let state = summary_at(&conn, time("2026-11-10T08:00:00Z")).unwrap();
        assert_eq!(state.events.len(), 3);
        assert_eq!(state.upcoming[0].stage, "needs_review");
        assert_eq!(state.upcoming[0].successful_reviews, 0);
        let latest: String = conn
            .query_row("SELECT mastery FROM topic_progress", [], |r| r.get(0))
            .unwrap();
        assert_eq!(latest, "passed");
        let raw: String = conn
            .query_row(
                "SELECT created_at FROM quiz_attempts WHERE attempt_id='attempt-first'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(raw, "2026-11-10T10:00:00+04:00");
        assert_eq!(state.events[2].created_at, "2026-11-10T06:00:00+00:00");
    }
    #[test]
    fn invalid_legacy_timestamp_rolls_back_backfill_instead_of_inventing_a_date() {
        let mut conn = database();
        insert_attempt(&conn, "attempt-invalid", true, "invalid timestamp");
        {
            let tx = conn.transaction().unwrap();
            assert!(backfill(&tx).is_err());
        }
        let count: i64 = conn
            .query_row("SELECT count(*) FROM review_schedule", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
