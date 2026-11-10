CREATE TABLE project_plans (id TEXT PRIMARY KEY, title TEXT NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE project_milestones (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project_plans(id), title TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('work','exit_review')), optional INTEGER NOT NULL CHECK(optional IN (0,1)),
 position INTEGER NOT NULL, metadata_json TEXT NOT NULL
);
CREATE TABLE project_tasks (
 id TEXT PRIMARY KEY, milestone_id TEXT NOT NULL REFERENCES project_milestones(id),
 title TEXT NOT NULL, done_when TEXT NOT NULL, position INTEGER NOT NULL
);
CREATE TABLE project_milestone_state (
 milestone_id TEXT PRIMARY KEY REFERENCES project_milestones(id),
 status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','in_progress','ready_for_review','completed')),
 evidence_note TEXT NOT NULL DEFAULT '', review_note TEXT, reviewed_at TEXT, updated_at TEXT,
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0)
);
CREATE TABLE project_task_state (task_id TEXT PRIMARY KEY REFERENCES project_tasks(id), done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)));
CREATE TABLE project_actions (
 request_id TEXT PRIMARY KEY, milestone_id TEXT NOT NULL REFERENCES project_milestones(id),
 action TEXT NOT NULL CHECK(action IN ('saved','reviewed','reopened','invalidated')),
 payload_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, definition_json TEXT NOT NULL,
 reason TEXT, xp_awarded INTEGER NOT NULL CHECK(xp_awarded IN (0,50)), created_at TEXT NOT NULL
);
CREATE INDEX project_milestone_order ON project_milestones(project_id,position);
CREATE INDEX project_task_order ON project_tasks(milestone_id,position);
CREATE INDEX project_action_time ON project_actions(created_at);
