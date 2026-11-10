import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  FolderGit2,
  History,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { projects, projectMilestones } from "../curriculum/data";
import type { ProjectMilestone } from "../curriculum/data";
import { native } from "./backend";
import {
  progressDraftChanged,
  savedProjectDraft,
  useProjects,
} from "./ProjectProvider";
import type { MilestoneProgress, ProjectDraft } from "./ProjectProvider";
const statusLabel = (status: string) =>
  status === "completed"
    ? "Self-reviewed"
    : status === "ready_for_review"
      ? "Ready for self-review"
      : status === "in_progress"
        ? "In progress"
        : status === "not_started"
          ? "Not started"
          : "Saved status unavailable";
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "No saved activity";
const chars = (text: string) => [...text.trim()].length;
export default function ProjectPage({
  otherBusy = false,
}: {
  otherBusy?: boolean;
}) {
  const c = useProjects();
  const selected = projects.find((p) => p.id === c.selection.projectId);
  const definitions = selected
    ? projectMilestones.filter((m) => m.projectId === selected.id)
    : [];
  const chosen =
    definitions.find((m) => m.id === c.selection.milestoneId) ?? definitions[0];
  function open(id: string) {
    const list = projectMilestones.filter((m) => m.projectId === id);
    const next =
      list.find(
        (m) =>
          !m.optional &&
          c.summary?.milestones.find((p) => p.milestoneId === m.id)?.status !==
            "completed",
      ) ?? list[0];
    c.setSelection({ projectId: id, milestoneId: next?.id ?? null });
  }
  return (
    <>
      <div className="project-workspace-summary">
        <span>
          <ShieldCheck size={14} />
          Completion records your own evidence review; it is not independent
          verification.
        </span>
        <button
          className="text-button"
          disabled={!native || c.loading || c.busy || c.pending}
          onClick={c.refresh}
        >
          <RefreshCw size={12} />
          {c.loading ? "Refreshing…" : "Refresh saved state"}
        </button>
      </div>
      {c.notice && (
        <div className="project-notice" role="status">
          <CheckCircle2 size={15} />
          {c.notice}
        </div>
      )}
      {(c.error || (c.pending && !c.busy)) && (
        <div className="project-error" role="alert">
          <p>
            {c.error ||
              "A project action needs confirmation. Retry it before changing saved progress."}
          </p>
          {c.pending && (
            <button
              className="secondary-button"
              disabled={c.busy || otherBusy}
              onClick={c.retry}
            >
              <RefreshCw size={13} />
              Retry pending project action
            </button>
          )}
        </div>
      )}
      {!native && (
        <p className="project-browser-note">
          Browser preview shows the roadmap definitions only. Saved tasks,
          evidence, self-reviews, and project XP require the desktop app.
        </p>
      )}
      {!selected ? (
        <>
          <div className="project-evidence-totals">
            <div>
              <strong>
                {c.summary
                  ? `${c.summary.completedRequiredMilestones} / ${c.summary.totalRequiredMilestones}`
                  : "—"}
              </strong>
              <span>REQUIRED MILESTONES SELF-REVIEWED</span>
            </div>
            <div>
              <strong>
                {c.summary?.totalXpEarned ?? "—"}
                <small>XP</small>
              </strong>
              <span>ONE-TIME PROJECT REWARDS EARNED</span>
            </div>
          </div>
          <div className="project-grid">
            {projects.map((p, i) => {
              const saved = c.summary?.projects.find(
                (x) => x.projectId === p.id,
              );
              const required = projectMilestones.filter(
                (m) => m.projectId === p.id && !m.optional,
              ).length;
              return (
                <button
                  className={`project-card ${i === 0 ? "cyan" : i === 3 ? "purple" : "green"}`}
                  key={p.id}
                  onClick={() => open(p.id)}
                >
                  <div className="card-topline">
                    <span className="project-number">PROJECT 0{i + 1}</span>
                    <FolderGit2 size={23} />
                  </div>
                  <h2>{p.title}</h2>
                  <code>{p.repo}</code>
                  <p>{p.summary}</p>
                  <div className="project-card-progress">
                    <span>
                      {saved
                        ? saved.status === "completed"
                          ? "Project self-reviewed"
                          : statusLabel(saved.status)
                        : c.loading
                          ? "Loading saved progress…"
                          : "Saved progress unavailable"}
                    </span>
                    <strong>
                      {saved?.completedRequiredMilestones ?? "—"} / {required}
                    </strong>
                  </div>
                  <div className="progress-bar">
                    <span
                      style={{
                        width: `${saved && required ? (saved.completedRequiredMilestones / required) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="project-card-foot">
                    <span>
                      {
                        projectMilestones.filter((m) => m.projectId === p.id)
                          .length
                      }{" "}
                      milestones · required exit review
                    </span>
                    <ArrowRight size={16} />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <button
            className="text-button project-back"
            onClick={() =>
              c.setSelection({ projectId: null, milestoneId: null })
            }
          >
            <ArrowLeft size={14} />
            All four projects
          </button>
          <div className="project-detail-heading">
            <div>
              <span className="eyebrow">PROJECT WORKSPACE</span>
              <h2>{selected.title}</h2>
              <code>{selected.repo}</code>
            </div>
            <span className="small-tag">SELF-REVIEWED EVIDENCE</span>
          </div>
          <div className="project-definition">
            <ShieldCheck size={18} />
            <div>
              <h3>Project definition of done</h3>
              <p>{selected.definitionOfDone}</p>
              <small>
                The final exit review checks this whole-project definition after
                every other required milestone. Optional stretch work stays
                separate.
              </small>
            </div>
          </div>
          <label className="mobile-milestone-picker">
            Milestone
            <select
              value={chosen?.id ?? ""}
              onChange={(e) =>
                c.setSelection({
                  projectId: selected.id,
                  milestoneId: e.target.value,
                })
              }
            >
              {definitions.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.title}
                  {m.optional ? " (optional)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="project-detail-grid">
            <aside className="milestone-sidebar">
              <span className="eyebrow">YOUR IMPLEMENTATION PATH</span>
              <nav aria-label="Project milestones">
                {definitions.map((m, i) => {
                  const saved = c.summary?.milestones.find(
                    (p) => p.milestoneId === m.id,
                  );
                  return (
                    <button
                      className={chosen?.id === m.id ? "selected" : ""}
                      key={m.id}
                      onClick={() =>
                        c.setSelection({
                          projectId: selected.id,
                          milestoneId: m.id,
                        })
                      }
                    >
                      <span
                        className={`milestone-step ${saved?.status === "completed" ? "reviewed" : ""}`}
                      >
                        {saved?.status === "completed" ? (
                          <Check size={12} />
                        ) : (
                          String(i + 1).padStart(2, "0")
                        )}
                      </span>
                      <span>
                        <strong>{m.title}</strong>
                        <small>
                          {m.optional
                            ? "Optional stretch"
                            : m.kind === "exit_review"
                              ? "Required exit review"
                              : "Required milestone"}{" "}
                          · {statusLabel(saved?.status ?? "")}
                        </small>
                      </span>
                      <ChevronRight size={13} />
                    </button>
                  );
                })}
              </nav>
            </aside>
            {chosen && (
              <MilestoneWorkspace
                key={chosen.id}
                definition={chosen}
                otherBusy={otherBusy}
              />
            )}
          </div>
          <ProjectHistory projectId={selected.id} />
        </>
      )}
    </>
  );
}
function MilestoneWorkspace({
  definition,
  otherBusy,
}: {
  definition: ProjectMilestone;
  otherBusy: boolean;
}) {
  const c = useProjects();
  const saved = c.summary?.milestones.find(
    (p) => p.milestoneId === definition.id,
  );
  const [acknowledgedVersion, setAcknowledgedVersion] = useState<number | null>(
    null,
  );
  const confirmed = !!saved && acknowledgedVersion === saved.version;
  const current = saved ? savedProjectDraft(saved, definition.tasks) : null;
  const draft = c.drafts[definition.id] ?? current;
  const working = !!saved && !!draft && native;
  const blocked = !working || c.busy || c.pending || otherBusy;
  const stale = !!draft && !!saved && draft.baseVersion !== saved.version;
  const dirty = !!draft && !!current && progressDraftChanged(draft, current);
  const allChecked =
    !!draft &&
    definition.tasks.every(
      (t) => draft.taskChecks.find((x) => x.taskId === t.id)?.done,
    );
  const evidenceReady = !!draft && chars(draft.evidenceNote) >= 20;
  const otherRequired = projectMilestones.filter(
    (m) =>
      m.projectId === definition.projectId &&
      !m.optional &&
      m.id !== definition.id,
  );
  const unfinishedRequired = otherRequired.filter(
    (m) =>
      c.summary?.milestones.find((p) => p.milestoneId === m.id)?.status !==
      "completed",
  ).length;
  const exitBlocked =
    !!c.summary && definition.kind === "exit_review" && unfinishedRequired > 0;
  function update(next: Partial<ProjectDraft>) {
    if (draft) c.setDraft(definition.id, { ...draft, ...next });
  }
  const reviewReady =
    saved?.status === "ready_for_review" &&
    !dirty &&
    !stale &&
    !exitBlocked &&
    allChecked &&
    evidenceReady &&
    !!draft &&
    chars(draft.reviewNote) >= 20 &&
    confirmed;
  return (
    <section
      className="panel milestone-workspace"
      aria-label={`${definition.title} workspace`}
    >
      <div className="card-topline">
        <span className="eyebrow">
          {definition.optional
            ? "OPTIONAL STRETCH"
            : definition.kind === "exit_review"
              ? "REQUIRED EXIT REVIEW"
              : "REQUIRED MILESTONE"}
        </span>
        <span className={`milestone-status ${saved?.status ?? ""}`}>
          {statusLabel(saved?.status ?? "")}
        </span>
      </div>
      <h2>{definition.title}</h2>
      <p className="milestone-description">{definition.description}</p>
      <div className="milestone-done">
        <ClipboardCheck size={17} />
        <div>
          <h3>Done when</h3>
          <p>{definition.doneWhen}</p>
        </div>
      </div>
      {!working && (
        <p className="project-browser-note">
          {c.loading
            ? "Loading the saved milestone…"
            : native
              ? "Saved milestone state is unavailable. Refresh the workspace before recording changes."
              : "Open the desktop app to record your own implementation evidence."}
        </p>
      )}
      {stale && (
        <div className="project-conflict">
          <p>
            This milestone changed since your draft began. Your text remains
            here; compare it with the saved state before discarding or
            re-entering your edits.
          </p>
          <button
            className="secondary-button"
            disabled={c.busy || c.pending}
            onClick={() => c.discardDraft(definition.id)}
          >
            Discard local draft and load saved state
          </button>
          <details className="project-saved-comparison">
            <summary>View current saved evidence</summary>
            <p>Status: {statusLabel(saved?.status ?? "")}</p>
            <pre>{saved?.evidenceNote || "No saved evidence note."}</pre>
            {saved?.reviewNote && <pre>{saved.reviewNote}</pre>}
          </details>
        </div>
      )}
      <div className="milestone-tasks">
        <h3>Your implementation checklist</h3>
        <p>Check a task after you have evidence from your own work.</p>
        {definition.tasks.map((task) => (
          <label key={task.id}>
            <input
              type="checkbox"
              aria-label={`Task: ${task.title}`}
              checked={
                draft?.taskChecks.find((t) => t.taskId === task.id)?.done ??
                false
              }
              disabled={blocked || stale}
              onChange={(e) => {
                if (draft)
                  update({
                    taskChecks: draft.taskChecks.map((t) =>
                      t.taskId === task.id
                        ? { ...t, done: e.target.checked }
                        : t,
                    ),
                  });
              }}
            />
            <span>
              <strong>{task.title}</strong>
              <small>{task.doneWhen}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="milestone-evidence">
        <h3>
          <FileText size={14} />
          Evidence note & references
        </h3>
        <p>
          Describe what the artifacts show. Add test output, raw measurements,
          hardware/compiler setup, commits, paths, or report references as
          appropriate.
        </p>
        <div className="evidence-hints">
          {definition.evidenceHints.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        <textarea
          aria-label="Milestone evidence note"
          maxLength={20000}
          value={draft?.evidenceNote ?? ""}
          disabled={blocked || stale}
          onChange={(e) => update({ evidenceNote: e.target.value })}
          placeholder="Record actual evidence and its limits. You review the referenced artifacts yourself; this app records your decision."
        />
        <div className="evidence-editor-footer">
          <span>
            {chars(draft?.evidenceNote ?? "")} characters · at least 20 for
            review
          </span>
          <span>
            {!working
              ? "READ-ONLY DEFINITION"
              : dirty
                ? "UNSAVED DRAFT"
                : "SAVED STATE"}
          </span>
        </div>
        <label className="milestone-working-status">
          Working status
          <select
            aria-label="Milestone working status"
            value={draft?.status ?? "not_started"}
            disabled={blocked || stale}
            onChange={(e) =>
              update({ status: e.target.value as ProjectDraft["status"] })
            }
          >
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option
              value="ready_for_review"
              disabled={!allChecked || !evidenceReady}
            >
              Ready for self-review
            </option>
          </select>
        </label>
        {saved?.status === "completed" && dirty && (
          <p className="project-reopen-warning">
            Saving changes reopens this milestone for review. Changes to
            required work also reopen an already-reviewed final exit check.
            Earlier XP stays earned.
          </p>
        )}
        <button
          className="secondary-button"
          disabled={
            blocked ||
            stale ||
            !dirty ||
            (draft?.status === "ready_for_review" &&
              (!allChecked || !evidenceReady))
          }
          onClick={() => {
            if (draft) void c.save(definition.id, draft);
          }}
        >
          <Save size={13} />
          {c.busy ? "Saving…" : "Save task progress & evidence"}
        </button>
      </div>
      {saved?.status === "completed" ? (
        <>
          <div className="milestone-saved-review">
            <span className="eyebrow">
              <CheckCircle2 size={14} />
              YOUR SAVED SELF-REVIEW
            </span>
            <p>{saved.reviewNote}</p>
            <small>
              Recorded {date(saved.reviewedAt)}. This is your review, not an
              independent assessment.
            </small>
          </div>
          <div className="milestone-review-form">
            <h3>Reopen without editing evidence</h3>
            <p>
              Use this when the work needs another look. The saved history and
              earlier XP remain.
            </p>
            <textarea
              aria-label="Reason to reopen milestone"
              maxLength={10000}
              value={draft?.reopenReason ?? ""}
              disabled={blocked || stale}
              onChange={(e) => update({ reopenReason: e.target.value })}
              placeholder="Explain why the milestone needs more work (at least 10 characters)."
            />
            <button
              className="secondary-button"
              disabled={
                blocked ||
                stale ||
                dirty ||
                chars(draft?.reopenReason ?? "") < 10
              }
              onClick={() => {
                if (draft) void c.reopen(definition.id, draft);
              }}
            >
              <RotateCcw size={12} />
              Reopen milestone
            </button>
            {dirty && (
              <p className="micro-copy">
                Save your evidence edits above to reopen with those changes.
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="milestone-review-form">
          <span className="eyebrow">
            <ShieldCheck size={14} />
            EXPLICIT SELF-REVIEW
          </span>
          <h3>Review the saved evidence before completion.</h3>
          <p>
            Save all checked tasks and evidence with “Ready for self-review”
            first. Explain how the saved artifacts meet the criterion and where
            limitations remain.
          </p>
          {exitBlocked && (
            <p className="project-reopen-warning">
              {unfinishedRequired} other required{" "}
              {unfinishedRequired === 1
                ? "milestone still needs"
                : "milestones still need"}{" "}
              self-review before this final exit review. Optional stretch
              milestones are not blockers.
            </p>
          )}
          <textarea
            aria-label="Milestone self-review note"
            maxLength={10000}
            value={draft?.reviewNote ?? ""}
            disabled={blocked || stale}
            onChange={(e) => update({ reviewNote: e.target.value })}
            placeholder="Explain your review of the actual saved evidence (at least 20 characters)."
          />
          <label className="milestone-review-ack">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={blocked || stale}
              onChange={(e) =>
                setAcknowledgedVersion(
                  e.target.checked && saved ? saved.version : null,
                )
              }
            />
            <span>
              I reviewed the saved evidence against every task and the
              completion criterion. This records my own review.
            </span>
          </label>
          <button
            className="primary-button"
            disabled={blocked || !reviewReady}
            onClick={() => {
              if (draft) void c.review(definition.id, draft);
            }}
          >
            <ShieldCheck size={14} />
            Save self-review
          </button>
          <p className="micro-copy">
            The first accepted self-review earns one milestone reward. Repeated
            reviews and project totals do not add duplicate XP.
          </p>
        </div>
      )}
      <p className="micro-copy">
        Source: {definition.sourceSection}. Progress is independent from
        reading, quizzes, timers, and Git activity.
      </p>
    </section>
  );
}
function ProjectHistory({ projectId }: { projectId: string }) {
  const c = useProjects();
  const definitions = projectMilestones.filter(
    (m) => m.projectId === projectId,
  );
  const history =
    c.summary?.history.filter(
      (h) =>
        h.definition?.projectId === projectId ||
        definitions.some((m) => m.id === h.milestoneId),
    ) ?? [];
  return (
    <section className="panel project-history">
      <div className="section-heading compact">
        <div>
          <h2>
            <History size={15} />
            Evidence & review history
          </h2>
          <p>
            This project’s entries within the latest 100 recorded project
            actions.
          </p>
        </div>
        <span className="small-tag">IMMUTABLE SAVED SNAPSHOTS</span>
      </div>
      {history.length ? (
        history.map((h) => (
          <details key={h.requestId + h.milestoneId + h.action}>
            <summary>
              <span>
                {h.action === "reviewed"
                  ? "Self-review recorded"
                  : h.action === "invalidated"
                    ? "Final exit review reopened"
                    : h.action === "reopened"
                      ? "Milestone reopened"
                      : "Progress saved"}
                <strong>
                  {h.definition?.title ??
                    definitions.find((m) => m.id === h.milestoneId)?.title}
                </strong>
                <small>{date(h.createdAt)}</small>
              </span>
              {h.xpAwarded > 0 && <em>+{h.xpAwarded} XP</em>}
              <ChevronRight size={14} />
            </summary>
            <div className="project-history-snapshot">
              <p>Status: {statusLabel(h.snapshot.status)}</p>
              {h.reason && <p>{h.reason}</p>}
              <strong>Saved evidence</strong>
              <pre>
                {h.snapshot.evidenceNote ||
                  "No evidence note saved with this action."}
              </pre>
              {h.snapshot.reviewNote && (
                <>
                  <strong>Saved self-review</strong>
                  <pre>{h.snapshot.reviewNote}</pre>
                </>
              )}
            </div>
          </details>
        ))
      ) : (
        <p className="empty-copy">
          {c.summary
            ? "No project actions have been recorded yet."
            : "Saved project history is unavailable."}
        </p>
      )}
    </section>
  );
}
