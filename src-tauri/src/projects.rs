use crate::{
    backup,
    store::{AppError, Dashboard, Result},
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
fn invalid(message: &str) -> AppError {
    backup::error("invalid_project_input", message)
}
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskCheck {
    pub task_id: String,
    pub done: bool,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneProgress {
    pub milestone_id: String,
    pub status: String,
    pub task_checks: Vec<TaskCheck>,
    pub evidence_note: String,
    pub review_note: Option<String>,
    pub reviewed_at: Option<String>,
    pub updated_at: Option<String>,
    pub version: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProgress {
    pub project_id: String,
    pub status: String,
    pub required_milestones: i64,
    pub completed_required_milestones: i64,
    pub optional_milestones: i64,
    pub completed_optional_milestones: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAction {
    pub request_id: String,
    pub milestone_id: String,
    pub action: String,
    pub created_at: String,
    pub xp_awarded: i64,
    pub reason: Option<String>,
    pub snapshot: MilestoneProgress,
    pub definition: Value,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub projects: Vec<ProjectProgress>,
    pub milestones: Vec<MilestoneProgress>,
    pub total_required_milestones: i64,
    pub completed_required_milestones: i64,
    pub total_xp_earned: i64,
    pub history: Vec<ProjectAction>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMutationResult {
    pub summary: ProjectSummary,
    pub dashboard: Dashboard,
    pub milestone_id: String,
    pub xp_awarded: i64,
    pub replayed: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskDefinition {
    id: String,
    title: String,
    done_when: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Definition {
    id: String,
    project_id: String,
    title: String,
    kind: String,
    optional: bool,
    tasks: Vec<TaskDefinition>,
}
pub(crate) struct Effect {
    pub milestone_id: String,
    pub xp_awarded: i64,
    pub replayed: bool,
}

pub(crate) fn seed(tx: &Transaction<'_>, curriculum: &Value) -> Result<()> {
    let projects = curriculum["projects"]
        .as_array()
        .ok_or_else(|| invalid("Bundled project plans are missing."))?;
    if projects.len() != 4
        || projects
            .iter()
            .filter_map(|p| p["id"].as_str())
            .collect::<std::collections::HashSet<_>>()
            != ["project-1", "project-2", "project-3", "project-4"]
                .into_iter()
                .collect()
    {
        return Err(invalid(
            "The four roadmap project identities must remain stable.",
        ));
    }
    for plan in projects {
        tx.execute("INSERT INTO project_plans(id,title,metadata_json) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET title=excluded.title,metadata_json=excluded.metadata_json",params![plan["id"].as_str(),plan["title"].as_str(),serde_json::to_string(plan)?])?;
    }
    let definitions = curriculum["projectMilestones"]
        .as_array()
        .ok_or_else(|| invalid("Bundled milestone definitions are missing."))?;
    let mut changed = Vec::new();
    let mut new_required = Vec::new();
    let mut ids = std::collections::HashSet::new();
    let mut tasks = std::collections::HashSet::new();
    for (position, raw) in definitions.iter().enumerate() {
        let definition: Definition = serde_json::from_value(raw.clone())?;
        if !ids.insert(definition.id.clone())
            || definition.tasks.is_empty()
            || !["work", "exit_review"].contains(&definition.kind.as_str())
            || (definition.kind == "exit_review" && definition.optional)
        {
            return Err(invalid("Bundled milestone definitions are invalid."));
        }
        let metadata = serde_json::to_string(raw)?;
        let task_ids = definition
            .tasks
            .iter()
            .map(|t| t.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        let old_tasks = tx
            .prepare("SELECT id FROM project_tasks WHERE milestone_id=?1")?
            .query_map([&definition.id], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if old_tasks.iter().any(|id| !task_ids.contains(id.as_str())) {
            return Err(invalid("Removing existing project tasks requires a dedicated migration; saved task evidence was preserved."));
        }
        let old_parent: Option<String> = tx
            .query_row(
                "SELECT project_id FROM project_milestones WHERE id=?1",
                [&definition.id],
                |r| r.get(0),
            )
            .optional()?;
        if old_parent
            .as_ref()
            .is_some_and(|p| p != &definition.project_id)
        {
            return Err(invalid(
                "A stable milestone ID cannot move between project plans.",
            ));
        }
        let old: Option<String> = tx
            .query_row(
                "SELECT metadata_json FROM project_milestones WHERE id=?1",
                [&definition.id],
                |r| r.get(0),
            )
            .optional()?;
        if old.is_none() && !definition.optional && definition.kind == "work" {
            new_required.push(definition.id.clone());
        }
        if old.as_ref().is_some_and(|old| old != &metadata) {
            changed.push(definition.id.clone());
        }
        tx.execute("INSERT INTO project_milestones(id,project_id,title,kind,optional,position,metadata_json) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET title=excluded.title,kind=excluded.kind,optional=excluded.optional,position=excluded.position,metadata_json=excluded.metadata_json",params![definition.id,definition.project_id,definition.title,definition.kind,definition.optional,position as i64,metadata])?;
        tx.execute(
            "INSERT OR IGNORE INTO project_milestone_state(milestone_id) VALUES(?1)",
            [&definition.id],
        )?;
        for (position, task) in definition.tasks.into_iter().enumerate() {
            let old_parent: Option<String> = tx
                .query_row(
                    "SELECT milestone_id FROM project_tasks WHERE id=?1",
                    [&task.id],
                    |r| r.get(0),
                )
                .optional()?;
            if old_parent.as_ref().is_some_and(|p| p != &definition.id) {
                return Err(invalid("A stable task ID cannot move between milestones."));
            }
            if !tasks.insert(task.id.clone()) {
                return Err(invalid("Bundled task IDs must be unique."));
            }
            tx.execute("INSERT INTO project_tasks(id,milestone_id,title,done_when,position) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET title=excluded.title,done_when=excluded.done_when,position=excluded.position",params![task.id,definition.id,task.title,task.done_when,position as i64])?;
            tx.execute(
                "INSERT OR IGNORE INTO project_task_state(task_id) VALUES(?1)",
                [&task.id],
            )?;
        }
    }
    let existing_ids = tx
        .prepare("SELECT id FROM project_milestones")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if existing_ids.iter().any(|id| !ids.contains(id)) {
        return Err(invalid("Removing existing milestones requires a dedicated migration; saved evidence was preserved."));
    }
    for plan in projects {
        let exits:i64=tx.query_row("SELECT count(*) FROM project_milestones WHERE project_id=?1 AND kind='exit_review' AND optional=0",[plan["id"].as_str()],|r|r.get(0))?;
        if exits != 1 {
            return Err(invalid(
                "Each project must have one required portfolio exit review.",
            ));
        }
    }
    for id in changed {
        invalidate(
            tx,
            &id,
            "The milestone definition changed; review the updated criteria before saving again.",
        )?;
        invalidate_exit(tx, &id)?;
    }
    for id in new_required {
        invalidate_exit(tx, &id)?;
    }

    Ok(())
}
fn load(conn: &Connection, id: &str) -> Result<MilestoneProgress> {
    let state=conn.query_row("SELECT milestone_id,status,evidence_note,review_note,reviewed_at,updated_at,version FROM project_milestone_state WHERE milestone_id=?1",[id],|r|Ok(MilestoneProgress {milestone_id:r.get(0)?,status:r.get(1)?,evidence_note:r.get(2)?,review_note:r.get(3)?,reviewed_at:r.get(4)?,updated_at:r.get(5)?,version:r.get(6)?,task_checks:Vec::new()})).optional()?.ok_or_else(||invalid("Unknown project milestone."))?;
    let task_checks=conn.prepare("SELECT t.id,s.done FROM project_tasks t JOIN project_task_state s ON s.task_id=t.id WHERE t.milestone_id=?1 ORDER BY t.position,t.id")?.query_map([id],|r|Ok(TaskCheck {task_id:r.get(0)?,done:r.get(1)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(MilestoneProgress {
        task_checks,
        ..state
    })
}
fn history(conn: &Connection) -> Result<Vec<ProjectAction>> {
    let rows=conn.prepare("SELECT request_id,milestone_id,action,created_at,xp_awarded,reason,snapshot_json,definition_json FROM project_actions ORDER BY created_at DESC,rowid DESC LIMIT 100")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
    rows.into_iter()
        .map(
            |(
                request_id,
                milestone_id,
                action,
                created_at,
                xp_awarded,
                reason,
                snapshot,
                definition,
            )| {
                Ok(ProjectAction {
                    request_id,
                    milestone_id,
                    action,
                    created_at,
                    xp_awarded,
                    reason,
                    snapshot: serde_json::from_str(&snapshot)?,
                    definition: serde_json::from_str(&definition)?,
                })
            },
        )
        .collect()
}
pub fn summary(conn: &Connection) -> Result<ProjectSummary> {
    let tx = conn.unchecked_transaction()?;
    let ids = tx
        .prepare("SELECT id FROM project_milestones ORDER BY project_id,position,id")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let milestones = ids
        .iter()
        .map(|id| load(&tx, id))
        .collect::<Result<Vec<_>>>()?;
    let plan_ids = tx
        .prepare("SELECT id FROM project_plans ORDER BY id")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut projects = Vec::new();
    for id in plan_ids {
        let (required,completed,optional,completed_optional,started):(i64,i64,i64,i64,i64)=tx.query_row("SELECT COALESCE(SUM(m.optional=0),0),COALESCE(SUM(m.optional=0 AND s.status='completed'),0),COALESCE(SUM(m.optional=1),0),COALESCE(SUM(m.optional=1 AND s.status='completed'),0),COALESCE(SUM(s.status<>'not_started'),0) FROM project_milestones m JOIN project_milestone_state s ON s.milestone_id=m.id WHERE m.project_id=?1",[&id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
        let status = if required > 0 && required == completed {
            "completed"
        } else if started > 0 {
            "in_progress"
        } else {
            "not_started"
        };
        projects.push(ProjectProgress {
            project_id: id,
            status: status.into(),
            required_milestones: required,
            completed_required_milestones: completed,
            optional_milestones: optional,
            completed_optional_milestones: completed_optional,
        });
    }
    let total_required_milestones = projects.iter().map(|p| p.required_milestones).sum();
    let completed_required_milestones = projects
        .iter()
        .map(|p| p.completed_required_milestones)
        .sum();
    let total_xp_earned = tx.query_row(
        "SELECT COALESCE(SUM(amount),0) FROM xp_ledger WHERE event_key LIKE 'project-review:%'",
        [],
        |r| r.get(0),
    )?;
    let history = history(&tx)?;
    tx.commit()?;
    Ok(ProjectSummary {
        projects,
        milestones,
        total_required_milestones,
        completed_required_milestones,
        total_xp_earned,
        history,
    })
}
fn validate_text(text: &str, min: usize, max: usize, label: &str) -> Result<String> {
    let text = text.trim();
    if text.chars().count() < min
        || text.len() > max
        || text
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        return Err(invalid(&format!("{label} must contain at least {min} characters and at most {max} bytes, without unsupported control characters.")));
    }
    Ok(text.into())
}
fn check_request(request: &str) -> Result<()> {
    if request.len() < 8
        || request.len() > 128
        || !request
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(invalid(
            "Use a unique project request ID of 8–128 letters, digits, hyphens or underscores.",
        ));
    }
    Ok(())
}
fn replay(
    conn: &Connection,
    request: &str,
    id: &str,
    action: &str,
    payload: &str,
) -> Result<Option<Effect>> {
    let previous:Option<(String,String,String,i64)>=conn.query_row("SELECT milestone_id,action,payload_json,xp_awarded FROM project_actions WHERE request_id=?1",[request],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    if let Some((old_id, old_action, old_payload, xp)) = previous {
        if old_id != id || old_action != action || old_payload != payload {
            return Err(invalid(
                "This project request ID was already used for different changes.",
            ));
        }
        return Ok(Some(Effect {
            milestone_id: id.into(),
            xp_awarded: xp,
            replayed: true,
        }));
    }
    Ok(None)
}
fn check_version(state: &MilestoneProgress, expected: i64) -> Result<i64> {
    if expected < 0 || expected != state.version {
        return Err(backup::error("stale_project_state","This milestone changed in another view. Refresh it and review your draft before saving."));
    }
    expected
        .checked_add(1)
        .ok_or_else(|| invalid("The milestone version is outside the supported range."))
}
fn complete_checks(state: &MilestoneProgress) -> bool {
    !state.task_checks.is_empty() && state.task_checks.iter().all(|t| t.done)
}
fn record(
    tx: &Transaction<'_>,
    request: &str,
    id: &str,
    action: &str,
    payload: &str,
    reason: Option<&str>,
    xp: i64,
) -> Result<()> {
    let state = load(tx, id)?;
    let definition: String = tx.query_row(
        "SELECT metadata_json FROM project_milestones WHERE id=?1",
        [id],
        |r| r.get(0),
    )?;
    tx.execute("INSERT INTO project_actions(request_id,milestone_id,action,payload_json,snapshot_json,definition_json,reason,xp_awarded,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![request,id,action,payload,serde_json::to_string(&state)?,definition,reason,xp,Utc::now().to_rfc3339()])?;
    Ok(())
}
fn invalidate(tx: &Transaction<'_>, id: &str, reason: &str) -> Result<()> {
    tx.execute("UPDATE project_milestone_state SET status=CASE WHEN status='not_started' THEN 'not_started' ELSE 'in_progress' END,review_note=NULL,reviewed_at=NULL,updated_at=?2,version=version+1 WHERE milestone_id=?1",params![id,Utc::now().to_rfc3339()])?;
    let request: String = tx.query_row("SELECT 'auto-'||lower(hex(randomblob(16)))", [], |r| {
        r.get(0)
    })?;
    record(tx, &request, id, "invalidated", "{}", Some(reason), 0)
}
fn invalidate_exit(tx: &Transaction<'_>, changed_id: &str) -> Result<()> {
    let (project, optional, kind): (String, bool, String) = tx.query_row(
        "SELECT project_id,optional,kind FROM project_milestones WHERE id=?1",
        [changed_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if optional || kind == "exit_review" {
        return Ok(());
    }
    let exit:Option<String>=tx.query_row("SELECT m.id FROM project_milestones m JOIN project_milestone_state s ON s.milestone_id=m.id WHERE m.project_id=?1 AND m.kind='exit_review' AND s.status='completed'",[&project],|r|r.get(0)).optional()?;
    if let Some(exit) = exit {
        invalidate(
            tx,
            &exit,
            "A required milestone changed after the portfolio exit review.",
        )?;
    }
    Ok(())
}
pub(crate) fn save(
    conn: &mut Connection,
    epoch: &str,
    id: &str,
    checks: Vec<TaskCheck>,
    evidence: &str,
    status: &str,
    expected: i64,
    request: &str,
) -> Result<Effect> {
    check_request(request)?;
    if !["not_started", "in_progress", "ready_for_review"].contains(&status) {
        return Err(invalid(
            "Choose a valid draft or ready-for-review milestone status.",
        ));
    }
    if checks.len() > 100 {
        return Err(invalid(
            "A milestone cannot contain more than 100 task checks.",
        ));
    }
    let evidence = validate_text(evidence, 0, 20_000, "Evidence notes")?;
    let mut checks = checks;
    checks.sort_by(|a, b| a.task_id.cmp(&b.task_id));
    let payload = serde_json::to_string(&(checks.clone(), &evidence, status, expected))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    backup::ensure_epoch(&tx, epoch)?;
    if let Some(effect) = replay(&tx, request, id, "saved", &payload)? {
        tx.commit()?;
        return Ok(effect);
    }
    let previous = load(&tx, id)?;
    let version = check_version(&previous, expected)?;
    let mut known = previous
        .task_checks
        .iter()
        .map(|t| t.task_id.as_str())
        .collect::<Vec<_>>();
    known.sort();
    if checks
        .iter()
        .map(|t| t.task_id.as_str())
        .collect::<Vec<_>>()
        != known
    {
        return Err(invalid(
            "Save exactly one check for each task in this milestone.",
        ));
    }
    if status == "not_started" && (checks.iter().any(|t| t.done) || !evidence.is_empty()) {
        return Err(invalid(
            "A milestone with checked tasks or evidence should be marked in progress.",
        ));
    }
    if status == "ready_for_review"
        && (!checks.iter().all(|t| t.done) || evidence.chars().count() < 20)
    {
        return Err(invalid("Check every milestone task and save at least 20 characters of concrete evidence before review."));
    }
    for task in &checks {
        tx.execute(
            "UPDATE project_task_state SET done=?2 WHERE task_id=?1",
            params![task.task_id, task.done],
        )?;
    }
    tx.execute("UPDATE project_milestone_state SET status=?2,evidence_note=?3,review_note=NULL,reviewed_at=NULL,updated_at=?4,version=?5 WHERE milestone_id=?1",params![id,status,evidence,Utc::now().to_rfc3339(),version])?;
    if previous.status == "completed" {
        invalidate_exit(&tx, id)?;
    }
    record(&tx, request, id, "saved", &payload, None, 0)?;
    tx.commit()?;
    Ok(Effect {
        milestone_id: id.into(),
        xp_awarded: 0,
        replayed: false,
    })
}
pub(crate) fn review(
    conn: &mut Connection,
    epoch: &str,
    id: &str,
    note: &str,
    confirmed: bool,
    expected: i64,
    request: &str,
) -> Result<Effect> {
    check_request(request)?;
    let note = validate_text(note, 20, 10_000, "Self-review rationale")?;
    if !confirmed {
        return Err(invalid(
            "Confirm that you reviewed your evidence against this milestone's definition of done.",
        ));
    }
    let payload = serde_json::to_string(&(&note, confirmed, expected))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    backup::ensure_epoch(&tx, epoch)?;
    if let Some(effect) = replay(&tx, request, id, "reviewed", &payload)? {
        tx.commit()?;
        return Ok(effect);
    }
    let state = load(&tx, id)?;
    let version = check_version(&state, expected)?;
    if state.status != "ready_for_review"
        || !complete_checks(&state)
        || state.evidence_note.chars().count() < 20
    {
        return Err(invalid("Save all task checks and concrete evidence, then mark this milestone ready for review first."));
    }
    let (project, kind): (String, String) = tx.query_row(
        "SELECT project_id,kind FROM project_milestones WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if kind == "exit_review" {
        let unfinished:i64=tx.query_row("SELECT count(*) FROM project_milestones m JOIN project_milestone_state s ON s.milestone_id=m.id WHERE m.project_id=?1 AND m.id<>?2 AND m.optional=0 AND s.status<>'completed'",params![project,id],|r|r.get(0))?;
        if unfinished > 0 {
            return Err(invalid("Self-review every required project milestone before the final portfolio exit review."));
        }
    }
    let timestamp = Utc::now().to_rfc3339();
    tx.execute("UPDATE project_milestone_state SET status='completed',review_note=?2,reviewed_at=?3,updated_at=?3,version=?4 WHERE milestone_id=?1",params![id,note,timestamp,version])?;
    let xp = if tx.execute(
        "INSERT OR IGNORE INTO xp_ledger(event_key,amount,created_at) VALUES(?1,50,?2)",
        params![format!("project-review:{id}"), timestamp],
    )? > 0
    {
        50
    } else {
        0
    };
    record(&tx, request, id, "reviewed", &payload, None, xp)?;
    tx.commit()?;
    Ok(Effect {
        milestone_id: id.into(),
        xp_awarded: xp,
        replayed: false,
    })
}
pub(crate) fn reopen(
    conn: &mut Connection,
    epoch: &str,
    id: &str,
    reason: &str,
    expected: i64,
    request: &str,
) -> Result<Effect> {
    check_request(request)?;
    let reason = validate_text(reason, 10, 10_000, "Reopen reason")?;
    let payload = serde_json::to_string(&(&reason, expected))?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    backup::ensure_epoch(&tx, epoch)?;
    if let Some(effect) = replay(&tx, request, id, "reopened", &payload)? {
        tx.commit()?;
        return Ok(effect);
    }
    let state = load(&tx, id)?;
    let version = check_version(&state, expected)?;
    if state.status != "completed" {
        return Err(invalid("Only a self-reviewed milestone can be reopened."));
    }
    tx.execute("UPDATE project_milestone_state SET status='in_progress',review_note=NULL,reviewed_at=NULL,updated_at=?2,version=?3 WHERE milestone_id=?1",params![id,Utc::now().to_rfc3339(),version])?;
    invalidate_exit(&tx, id)?;
    record(&tx, request, id, "reopened", &payload, Some(&reason), 0)?;
    tx.commit()?;
    Ok(Effect {
        milestone_id: id.into(),
        xp_awarded: 0,
        replayed: false,
    })
}

pub(crate) fn validate_integrity(conn: &Connection) -> Result<()> {
    let summary = summary(conn)?;
    for state in &summary.milestones {
        if ["ready_for_review", "completed"].contains(&state.status.as_str())
            && (!complete_checks(state) || state.evidence_note.chars().count() < 20)
        {
            return Err(invalid(
                "A review-ready project record is missing task checks or concrete evidence.",
            ));
        }
        if state.status == "completed"
            && (state
                .review_note
                .as_ref()
                .is_none_or(|s| s.chars().count() < 20)
                || state.reviewed_at.is_none())
        {
            return Err(invalid(
                "A completed project record is missing explicit self-review evidence.",
            ));
        }
        if let Some(date) = &state.reviewed_at {
            chrono::DateTime::parse_from_rfc3339(date)
                .map_err(|_| invalid("A project review timestamp is invalid."))?;
        }
    }
    // A completed row needs the explicit-review snapshot for its exact version.
    // This validates record consistency, never the truth of user-authored evidence.
    let mut matched = std::collections::HashSet::new();
    let mut statement=conn.prepare("SELECT milestone_id,action,payload_json,snapshot_json,definition_json FROM project_actions")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let action: String = row.get(1)?;
        let payload: String = row.get(2)?;
        let snapshot: String = row.get(3)?;
        let definition: String = row.get(4)?;
        if payload.len() > 100_000 || snapshot.len() > 100_000 || definition.len() > 100_000 {
            return Err(invalid(
                "A project history record exceeds the supported size.",
            ));
        }
        let _: Value = serde_json::from_str(&payload)?;
        let _: Value = serde_json::from_str(&definition)?;
        let snapshot: MilestoneProgress = serde_json::from_str(&snapshot)?;
        if snapshot.milestone_id != id {
            return Err(invalid(
                "A project history snapshot has inconsistent milestone identity.",
            ));
        }
        if action == "reviewed" {
            if let Some(current) = summary.milestones.iter().find(|s| {
                s.milestone_id == id && s.status == "completed" && s.version == snapshot.version
            }) {
                if current.evidence_note == snapshot.evidence_note
                    && current.review_note == snapshot.review_note
                    && current.reviewed_at == snapshot.reviewed_at
                    && current.task_checks == snapshot.task_checks
                {
                    matched.insert(id);
                }
            }
        }
    }
    if summary
        .milestones
        .iter()
        .any(|s| s.status == "completed" && !matched.contains(&s.milestone_id))
    {
        return Err(invalid(
            "A completed milestone has no matching explicit self-review record.",
        ));
    }
    let invalid_exits:i64=conn.query_row("SELECT count(*) FROM project_milestones e JOIN project_milestone_state s ON s.milestone_id=e.id WHERE e.kind='exit_review' AND s.status='completed' AND EXISTS(SELECT 1 FROM project_milestones m JOIN project_milestone_state p ON p.milestone_id=m.id WHERE m.project_id=e.project_id AND m.id<>e.id AND m.optional=0 AND p.status<>'completed')",[],|r|r.get(0))?;
    if invalid_exits > 0 {
        return Err(invalid(
            "A project exit review is completed while required milestones are unfinished.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    const EVIDENCE:&str="Ran the correctness suite and saved raw evidence at ./reports/result.txt; review the recorded command and output.";
    const RATIONALE:&str="I checked the saved evidence against every task and the roadmap definition of done; these are my self-reviewed results.";
    fn database() -> Store {
        Store::initialize(Connection::open_in_memory().unwrap()).unwrap()
    }
    fn state(store: &Store, id: &str) -> MilestoneProgress {
        store
            .get_project_summary()
            .unwrap()
            .milestones
            .into_iter()
            .find(|m| m.milestone_id == id)
            .unwrap()
    }
    fn ready(store: &mut Store, id: &str, request: &str) -> crate::projects::ProjectMutationResult {
        let old = state(store, id);
        let checks = old
            .task_checks
            .into_iter()
            .map(|mut t| {
                t.done = true;
                t
            })
            .collect();
        store
            .save_project_milestone(
                id,
                checks,
                EVIDENCE,
                "ready_for_review",
                old.version,
                request,
            )
            .unwrap()
    }
    fn complete(store: &mut Store, id: &str, prefix: &str) {
        ready(store, id, &format!("{prefix}-save"));
        let old = state(store, id);
        store
            .review_project_milestone(
                id,
                RATIONALE,
                true,
                old.version,
                &format!("{prefix}-review"),
            )
            .unwrap();
    }
    #[test]
    fn four_plans_seed_unstarted_with_all_tasks_and_no_fabricated_progress() {
        let store = database();
        let summary = store.get_project_summary().unwrap();
        assert_eq!(summary.projects.len(), 4);
        assert_eq!(summary.milestones.len(), 35);
        assert_eq!(summary.total_required_milestones, 31);
        assert_eq!(summary.completed_required_milestones, 0);
        assert_eq!(summary.total_xp_earned, 0);
        assert!(summary.history.is_empty());
        assert_eq!(
            summary
                .milestones
                .iter()
                .map(|m| m.task_checks.len())
                .sum::<usize>(),
            75
        );
        assert!(summary.milestones.iter().all(|m| m.status == "not_started"
            && m.version == 0
            && m.evidence_note.is_empty()
            && m.review_note.is_none()
            && m.task_checks.iter().all(|t| !t.done)));
    }
    #[test]
    fn explicit_review_is_required_and_xp_is_once_even_after_reopen_and_recompletion() {
        let mut store = database();
        let id = "p1-order-contract";
        assert!(store
            .review_project_milestone(id, RATIONALE, true, 0, "premature-review")
            .is_err());
        let saved = ready(&mut store, id, "initial-save");
        assert_eq!(saved.dashboard.total_xp, 0);
        assert_eq!(saved.xp_awarded, 0);
        assert_eq!(state(&store, id).status, "ready_for_review");
        assert!(store
            .review_project_milestone(id, RATIONALE, false, 1, "without-confirm")
            .is_err());
        assert!(store
            .review_project_milestone(id, "Looks fine", true, 1, "short-rationale")
            .is_err());
        let reviewed = store
            .review_project_milestone(id, RATIONALE, true, 1, "first-project-review")
            .unwrap();
        assert_eq!(reviewed.xp_awarded, 50);
        assert_eq!(reviewed.dashboard.total_xp, 50);
        assert_eq!(state(&store, id).status, "completed");
        let replay = store
            .review_project_milestone(id, RATIONALE, true, 1, "first-project-review")
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.summary.total_xp_earned, 50);
        assert_eq!(replay.summary.history.len(), 2);
        store
            .reopen_project_milestone(
                id,
                "Need to rerun after changing inputs",
                2,
                "reopen-project-work",
            )
            .unwrap();
        assert!(state(&store, id).reviewed_at.is_none());
        ready(&mut store, id, "second-save");
        let version = state(&store, id).version;
        let again = store
            .review_project_milestone(id, RATIONALE, true, version, "second-project-review")
            .unwrap();
        assert_eq!(again.xp_awarded, 0);
        assert_eq!(again.dashboard.total_xp, 50);
        let first = again
            .summary
            .history
            .iter()
            .find(|h| h.request_id == "first-project-review")
            .unwrap();
        assert_eq!(first.snapshot.evidence_note, EVIDENCE);
        assert_eq!(first.snapshot.review_note.as_deref(), Some(RATIONALE));
        assert_eq!(first.definition["id"], id);
    }
    #[test]
    fn invalid_checks_evidence_versions_and_request_collisions_do_not_mutate_state() {
        let mut store = database();
        let id = "p1-order-contract";
        let old = state(&store, id);
        assert!(store
            .save_project_milestone(
                id,
                vec![],
                EVIDENCE,
                "ready_for_review",
                0,
                "missing-task-checks"
            )
            .is_err());
        let mut duplicate = old.task_checks.clone();
        duplicate[1].task_id = duplicate[0].task_id.clone();
        assert!(store
            .save_project_milestone(
                id,
                duplicate,
                EVIDENCE,
                "in_progress",
                0,
                "duplicate-task-checks"
            )
            .is_err());
        let mut unknown = old.task_checks.clone();
        unknown[0].task_id = "unknown-task".into();
        assert!(store
            .save_project_milestone(
                id,
                unknown,
                EVIDENCE,
                "in_progress",
                0,
                "unknown-task-check"
            )
            .is_err());
        assert!(store
            .save_project_milestone(
                id,
                old.task_checks.clone(),
                "short",
                "ready_for_review",
                0,
                "short-evidence"
            )
            .is_err());
        assert!(store
            .save_project_milestone(
                id,
                old.task_checks.clone(),
                EVIDENCE,
                "completed",
                0,
                "direct-complete"
            )
            .is_err());
        assert!(store
            .save_project_milestone(
                id,
                old.task_checks.clone(),
                EVIDENCE,
                "not_started",
                0,
                "contradictory-status"
            )
            .is_err());
        assert_eq!(state(&store, id).version, 0);
        assert!(store.get_project_summary().unwrap().history.is_empty());
        let first = store
            .save_project_milestone(
                id,
                old.task_checks.clone(),
                EVIDENCE,
                "in_progress",
                0,
                "versioned-save",
            )
            .unwrap();
        assert_eq!(first.xp_awarded, 0);
        assert!(store
            .save_project_milestone(
                id,
                old.task_checks.clone(),
                "Changed evidence content",
                "in_progress",
                0,
                "versioned-save"
            )
            .is_err());
        assert_eq!(
            store
                .save_project_milestone(
                    id,
                    old.task_checks,
                    EVIDENCE,
                    "in_progress",
                    0,
                    "stale-version-save"
                )
                .unwrap_err()
                .code,
            "stale_project_state"
        );
        assert_eq!(state(&store, id).version, 1);
    }
    #[test]
    fn project_requires_exit_review_and_upstream_changes_invalidate_that_review() {
        let mut store = database();
        ready(&mut store, "p1-exit-review", "early-exit-save");
        assert!(store
            .review_project_milestone("p1-exit-review", RATIONALE, true, 1, "early-exit-review")
            .is_err());
        for id in [
            "p1-order-contract",
            "p1-replay",
            "p1-benchmarks",
            "p1-optimization",
        ] {
            complete(&mut store, id, id);
        }
        let before = store.get_project_summary().unwrap();
        assert_eq!(before.projects[0].status, "in_progress");
        assert_eq!(before.projects[0].completed_required_milestones, 4);
        let version = state(&store, "p1-exit-review").version;
        store
            .review_project_milestone(
                "p1-exit-review",
                RATIONALE,
                true,
                version,
                "valid-exit-review",
            )
            .unwrap();
        assert_eq!(
            store.get_project_summary().unwrap().projects[0].status,
            "completed"
        );
        let old = state(&store, "p1-replay");
        store
            .save_project_milestone(
                "p1-replay",
                old.task_checks,
                "Changed evidence: reran the replay suite with newly recorded fixtures.",
                "ready_for_review",
                old.version,
                "changed-upstream-evidence",
            )
            .unwrap();
        let exit = state(&store, "p1-exit-review");
        assert_eq!(exit.status, "in_progress");
        assert!(exit.reviewed_at.is_none());
        assert!(exit.review_note.is_none());
        assert_eq!(
            store.get_project_summary().unwrap().projects[0].status,
            "in_progress"
        );
        let old = state(&store, "p1-replay");
        store
            .review_project_milestone(
                "p1-replay",
                RATIONALE,
                true,
                old.version,
                "repeat-upstream-review",
            )
            .unwrap();
        assert_eq!(state(&store, "p1-exit-review").status, "in_progress");
        ready(&mut store, "p1-exit-review", "repeat-exit-save");
        let version = state(&store, "p1-exit-review").version;
        let result = store
            .review_project_milestone(
                "p1-exit-review",
                RATIONALE,
                true,
                version,
                "repeat-exit-review",
            )
            .unwrap();
        assert_eq!(result.xp_awarded, 0);
        assert_eq!(result.summary.projects[0].status, "completed");
        assert_eq!(result.summary.total_xp_earned, 250);
        assert!(result
            .summary
            .history
            .iter()
            .any(|h| h.action == "invalidated" && h.milestone_id == "p1-exit-review"));
    }
    #[test]
    fn optional_milestones_never_block_required_exit_or_invalidate_completed_project() {
        let mut store = database();
        let ids=store.conn.prepare("SELECT id FROM project_milestones WHERE project_id='project-3' AND optional=0 AND kind='work' ORDER BY position").unwrap().query_map([],|r|r.get::<_,String>(0)).unwrap().collect::<std::result::Result<Vec<_>,_>>().unwrap();
        for id in ids {
            complete(&mut store, &id, &id);
        }
        complete(&mut store, "p3-exit-review", "project-three-exit");
        let summary = store.get_project_summary().unwrap();
        let project = summary
            .projects
            .iter()
            .find(|p| p.project_id == "project-3")
            .unwrap();
        assert_eq!(project.status, "completed");
        assert_eq!(project.completed_optional_milestones, 0);
        complete(&mut store, "p3-precision", "optional-precision");
        let old = state(&store, "p3-precision");
        store
            .reopen_project_milestone(
                "p3-precision",
                "Repeat optional accuracy evaluation",
                old.version,
                "optional-reopen",
            )
            .unwrap();
        assert_eq!(state(&store, "p3-exit-review").status, "completed");
        assert_eq!(
            store.get_project_summary().unwrap().projects[2].status,
            "completed"
        );
    }
    #[test]
    fn failed_audit_insert_rolls_back_review_and_xp_atomically() {
        let mut store = database();
        ready(&mut store, "p1-order-contract", "rollback-ready");
        store.conn.execute_batch("CREATE TRIGGER fail_project_audit BEFORE INSERT ON project_actions BEGIN SELECT RAISE(ABORT,'forced test failure'); END;").unwrap();
        assert!(store
            .review_project_milestone(
                "p1-order-contract",
                RATIONALE,
                true,
                1,
                "rollback-project-review"
            )
            .is_err());
        assert_eq!(
            state(&store, "p1-order-contract").status,
            "ready_for_review"
        );
        assert_eq!(state(&store, "p1-order-contract").version, 1);
        assert_eq!(store.dashboard().unwrap().total_xp, 0);
        assert_eq!(store.get_project_summary().unwrap().history.len(), 1);
    }
    #[test]
    fn seed_reopen_preserves_progress_and_definition_changes_require_new_review() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("project.sqlite3");
        {
            let mut store = Store::open(&path).unwrap();
            complete(&mut store, "p1-order-contract", "persist-project");
        }
        let mut store = Store::open(&path).unwrap();
        assert_eq!(state(&store, "p1-order-contract").status, "completed");
        assert_eq!(store.dashboard().unwrap().total_xp, 50);
        let mut curriculum: Value =
            serde_json::from_str(include_str!("../../curriculum/data.json")).unwrap();
        curriculum["projectMilestones"][0]["doneWhen"] =
            Value::String("Additional explicit evidence must now be reviewed.".into());
        let tx = store.conn.transaction().unwrap();
        seed(&tx, &curriculum).unwrap();
        tx.commit().unwrap();
        assert_eq!(state(&store, "p1-order-contract").status, "in_progress");
        assert_eq!(store.dashboard().unwrap().total_xp, 50);
        assert!(store
            .get_project_summary()
            .unwrap()
            .history
            .iter()
            .any(|h| h.action == "invalidated"));
    }
    #[test]
    fn competing_reviews_allow_one_commit_and_request_replay_never_reawards() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("concurrent.sqlite3");
        let mut first = Store::open(&path).unwrap();
        ready(&mut first, "p1-order-contract", "concurrent-ready");
        let mut second = Store::open(&path).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let other = barrier.clone();
        let a = std::thread::spawn(move || {
            barrier.wait();
            first.review_project_milestone(
                "p1-order-contract",
                RATIONALE,
                true,
                1,
                "concurrent-review-a",
            )
        });
        let b = std::thread::spawn(move || {
            other.wait();
            second.review_project_milestone(
                "p1-order-contract",
                RATIONALE,
                true,
                1,
                "concurrent-review-b",
            )
        });
        let outcomes = [a.join().unwrap(), b.join().unwrap()];
        assert_eq!(outcomes.iter().filter(|r| r.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter(|r| r.as_ref().is_err_and(|e| e.code == "stale_project_state"))
                .count(),
            1
        );
        let store = Store::open(&path).unwrap();
        assert_eq!(store.get_project_summary().unwrap().total_xp_earned, 50);
        assert_eq!(store.get_project_summary().unwrap().history.len(), 2);
    }
    fn catalog() -> Value {
        serde_json::from_str(include_str!("../../curriculum/data.json")).unwrap()
    }
    fn apply_catalog(store: &mut Store, catalog: &Value) {
        let tx = store.conn.transaction().unwrap();
        seed(&tx, catalog).unwrap();
        tx.commit().unwrap();
    }
    fn complete_project_one(store: &mut Store) {
        for id in [
            "p1-order-contract",
            "p1-replay",
            "p1-benchmarks",
            "p1-optimization",
            "p1-exit-review",
        ] {
            complete(store, id, id);
        }
    }
    #[test]
    fn changed_ready_and_unstarted_definitions_bump_versions_without_inventing_progress() {
        let mut store = database();
        ready(&mut store, "p1-order-contract", "catalog-ready-save");
        let mut data = catalog();
        data["projectMilestones"][0]["doneWhen"] =
            Value::String("Updated criteria requiring another explicit evidence check.".into());
        data["projectMilestones"][1]["description"] =
            Value::String("A refined description for unstarted work.".into());
        apply_catalog(&mut store, &data);
        let changed = state(&store, "p1-order-contract");
        assert_eq!(changed.version, 2);
        assert_eq!(changed.status, "in_progress");
        assert_eq!(changed.evidence_note, EVIDENCE);
        assert_eq!(
            store
                .review_project_milestone(
                    "p1-order-contract",
                    RATIONALE,
                    true,
                    1,
                    "stale-definition-review"
                )
                .unwrap_err()
                .code,
            "stale_project_state"
        );
        let untouched = state(&store, "p1-replay");
        assert_eq!(untouched.version, 1);
        assert_eq!(untouched.status, "not_started");
        assert!(untouched.task_checks.iter().all(|t| !t.done));
        assert_eq!(store.get_project_summary().unwrap().total_xp_earned, 0);
    }
    #[test]
    fn adding_required_work_invalidates_completed_exit_until_fresh_exit_review() {
        let mut store = database();
        complete_project_one(&mut store);
        let mut data = catalog();
        let mut added = data["projectMilestones"][0].clone();
        added["id"] = Value::String("p1-new-required-work".into());
        added["title"] = Value::String("Additional required evidence".into());
        added["tasks"][0]["id"] = Value::String("p1-new-required-task-a".into());
        added["tasks"][1]["id"] = Value::String("p1-new-required-task-b".into());
        data["projectMilestones"]
            .as_array_mut()
            .unwrap()
            .push(added);
        apply_catalog(&mut store, &data);
        assert_eq!(state(&store, "p1-new-required-work").status, "not_started");
        assert_eq!(state(&store, "p1-exit-review").status, "in_progress");
        complete(&mut store, "p1-new-required-work", "new-required");
        assert_eq!(
            store.get_project_summary().unwrap().projects[0].status,
            "in_progress"
        );
        assert_eq!(state(&store, "p1-exit-review").status, "in_progress");
        complete(&mut store, "p1-exit-review", "fresh-exit-after-catalog");
        assert_eq!(
            store.get_project_summary().unwrap().projects[0].status,
            "completed"
        );
        assert_eq!(store.get_project_summary().unwrap().total_xp_earned, 300);
    }
    #[test]
    fn making_unstarted_optional_work_required_invalidates_previous_exit_review() {
        let mut store = database();
        let ids=store.conn.prepare("SELECT id FROM project_milestones WHERE project_id='project-3' AND optional=0 ORDER BY position").unwrap().query_map([],|r|r.get::<_,String>(0)).unwrap().collect::<std::result::Result<Vec<_>,_>>().unwrap();
        for id in ids {
            complete(&mut store, &id, &id);
        }
        let mut data = catalog();
        let changed = data["projectMilestones"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|m| m["id"] == "p3-precision")
            .unwrap();
        changed["optional"] = Value::Bool(false);
        apply_catalog(&mut store, &data);
        assert_eq!(state(&store, "p3-precision").status, "not_started");
        assert_eq!(state(&store, "p3-precision").version, 1);
        assert_eq!(state(&store, "p3-exit-review").status, "in_progress");
        assert_eq!(
            store.get_project_summary().unwrap().projects[2].required_milestones,
            7
        );
    }
    #[test]
    fn unsupported_task_or_milestone_removal_rolls_back_without_losing_evidence() {
        let mut store = database();
        complete(&mut store, "p1-order-contract", "catalog-removal-fixture");
        let before = state(&store, "p1-order-contract");
        let mut data = catalog();
        data["projectMilestones"][0]["tasks"]
            .as_array_mut()
            .unwrap()
            .pop();
        {
            let tx = store.conn.transaction().unwrap();
            assert!(seed(&tx, &data).is_err());
        }
        assert_eq!(state(&store, "p1-order-contract").version, before.version);
        assert_eq!(state(&store, "p1-order-contract").status, "completed");
        assert_eq!(state(&store, "p1-order-contract").evidence_note, EVIDENCE);
        let mut data = catalog();
        data["projectMilestones"].as_array_mut().unwrap().remove(0);
        {
            let tx = store.conn.transaction().unwrap();
            assert!(seed(&tx, &data).is_err());
        }
        assert_eq!(store.get_project_summary().unwrap().milestones.len(), 35);
        assert_eq!(store.get_project_summary().unwrap().total_xp_earned, 50);
        assert_eq!(store.get_project_summary().unwrap().history.len(), 2);
    }
}
