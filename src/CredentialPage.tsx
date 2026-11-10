import { useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  GraduationCap,
  History,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { credentials } from "../curriculum/data";
import { native } from "./backend";
import { ArtworkEditor, LocalArtwork } from "./Artwork";
import "./CredentialArtwork.css";
import {
  credentialDraftChanged,
  savedCredentialDraft,
  useCredentials,
} from "./CredentialProvider";
import type { CredentialDraft, CredentialStatus } from "./CredentialProvider";
export const credentialStatusLabel = (status: string) =>
  status === "completed"
    ? "Self-reported complete"
    : status === "in_progress"
      ? "In progress"
      : status === "on_hold"
        ? "On hold"
        : status === "not_pursuing"
          ? "Not pursuing"
          : status === "not_started"
            ? "Not started"
            : "Saved status unavailable";
export function calendarDate(value: string | null) {
  return value
    ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
        dateStyle: "medium",
      })
    : "No personal target set";
}
const timestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "No update recorded";
const bytes = (value: string) => new TextEncoder().encode(value).length;
function CourseArtwork({
  id,
  title,
  compact = false,
}: {
  id: string;
  title: string;
  compact?: boolean;
}) {
  return (
    <LocalArtwork
      kind="course"
      itemId={id}
      title={title}
      className={`course-artwork${compact ? " course-artwork-compact" : ""}`}
      fallback={
        <span
          className={`course-artwork course-artwork-fallback${compact ? " course-artwork-compact" : ""}`}
          aria-hidden="true"
        >
          <GraduationCap size={compact ? 24 : 36} strokeWidth={1.25} />
        </span>
      }
    />
  );
}
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export default function CredentialPage({
  otherBusy = false,
}: {
  otherBusy?: boolean;
}) {
  const c = useCredentials();
  const definition =
    credentials.find((d) => d.id === c.selectedId) ?? credentials[0];
  const saved = c.summary?.items.find((p) => p.credentialId === definition.id);
  const base = saved ? savedCredentialDraft(saved) : null;
  const draft = c.drafts[definition.id] ?? base;
  const [attested, setAttested] = useState<string | null>(null);
  const signature = JSON.stringify({ id: definition.id, ...draft });
  const confirmed = attested === signature;
  const working = native && !!saved && !!draft;
  const blocked = !working || otherBusy || c.busy || c.pending;
  const stale = !!draft && !!saved && draft.baseVersion !== saved.version;
  const dirty = !!draft && !!base && credentialDraftChanged(draft, base);
  const complete = draft?.status === "completed";
  const evidenceReady = !!draft && [...draft.evidenceNote.trim()].length >= 20;
  const withinLimits =
    !!draft &&
    bytes(draft.evidenceNote) <= 20000 &&
    bytes(draft.evidenceReference) <= 2048;
  const ready =
    dirty &&
    !stale &&
    withinLimits &&
    (!complete || (evidenceReady && confirmed));
  const pastTarget =
    !!saved?.targetDate &&
    saved.targetDate < localToday() &&
    !["completed", "not_pursuing"].includes(saved.status);
  function update(value: Partial<CredentialDraft>) {
    if (draft) c.setDraft(definition.id, { ...draft, ...value });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="tiny-line" />
            COURSEWORK, WITH CONTEXT
          </div>
          <h1>Your learning, in your own words.</h1>
          <p>
            Track the roadmap’s four credential plans. Dates and completion are
            your own reports.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={!native || c.loading || c.busy || c.pending}
          onClick={c.refresh}
        >
          <RefreshCw size={13} />
          {c.loading ? "Refreshing…" : "Refresh course records"}
        </button>
      </div>
      <div className="credential-stats">
        <section className="panel">
          <GraduationCap size={20} />
          <strong>
            {c.summary?.completedCount ?? "—"}
            <small>/ {credentials.length}</small>
          </strong>
          <span>PLANS SELF-REPORTED COMPLETE</span>
        </section>
        <section className="panel">
          <FileText size={20} />
          <strong>{c.summary?.inProgressCount ?? "—"}</strong>
          <span>PERSONALLY MARKED IN PROGRESS</span>
        </section>
        <section className="panel">
          <ShieldCheck size={20} />
          <strong>
            0<small>XP</small>
          </strong>
          <span>AWARDED FOR CREDENTIAL CLAIMS</span>
        </section>
      </div>
      <div className="credential-scope">
        <ShieldCheck size={16} />
        <p>
          A course competency certificate, a specialization completion
          certificate, and a formal certification exam are different outcomes.
          This log records your report; issuing and verification remain with the
          provider. It adds no XP, project completion, or quiz mastery.
        </p>
      </div>
      {c.notice && (
        <p className="project-notice" role="status">
          <CheckCircle2 size={15} />
          {c.notice}
        </p>
      )}
      {(c.error || (c.pending && !c.busy)) && (
        <div className="project-error" role="alert">
          <p>{c.error || "A course update needs confirmation."}</p>
          {c.pending && (
            <button
              className="secondary-button"
              disabled={c.busy || otherBusy}
              onClick={c.retry}
            >
              <RefreshCw size={12} />
              Retry pending course update
            </button>
          )}
        </div>
      )}
      {!native && (
        <p className="project-browser-note">
          Browser preview shows the four roadmap plans only. No course status,
          target date, or completion evidence is recorded here.
        </p>
      )}
      <div className="credential-layout">
        <aside className="credential-plan-list" aria-label="Credential plans">
          {credentials.map((d) => {
            const progress = c.summary?.items.find(
              (p) => p.credentialId === d.id,
            );
            return (
              <button
                key={d.id}
                className={definition.id === d.id ? "selected" : ""}
                onClick={() => c.select(d.id)}
              >
                <CourseArtwork id={d.id} title={d.title} compact />
                <span className="eyebrow">
                  {d.optional ? "OPTIONAL PLAN" : "HIGH PRIORITY · ROADMAP"}
                </span>
                <h2>{d.title}</h2>
                <p>{d.provider}</p>
                <div>
                  <span>{d.kind}</span>
                  <ChevronRight size={13} />
                </div>
                <small
                  className={
                    progress?.status === "completed" ? "reported-complete" : ""
                  }
                >
                  {credentialStatusLabel(progress?.status ?? "")}
                  {progress?.targetDate &&
                    ` · target ${calendarDate(progress.targetDate)}`}
                </small>
              </button>
            );
          })}
        </aside>
        <section
          className="panel credential-editor"
          aria-label={`${definition.title} personal tracker`}
        >
          <div className="card-topline">
            <span className="eyebrow">{definition.kind}</span>
            <span className="small-tag">SELF-REPORTED</span>
          </div>
          <CourseArtwork id={definition.id} title={definition.title} />
          <h2>{definition.title}</h2>
          <p className="credential-provider">{definition.provider}</p>
          <ArtworkEditor
            kind="course"
            itemId={definition.id}
            title={definition.title}
            disabled={otherBusy || c.busy || c.pending}
          />
          <p>{definition.description}</p>
          <div className="credential-plan-window">
            <CalendarDays size={14} />
            <span>
              Roadmap window: {definition.months}. This is a study plan, not an
              exam booking.
            </span>
          </div>
          {!working && (
            <p className="project-browser-note">
              {c.loading
                ? "Loading your saved course record…"
                : native
                  ? "The saved record is unavailable. Refresh before editing."
                  : "Open the desktop app to record your personal plan."}
            </p>
          )}
          {stale && (
            <div className="project-conflict">
              <p>
                This record changed elsewhere. Your draft is preserved; compare
                it with the saved record before discarding and reapplying
                changes.
              </p>
              <details>
                <summary>View current saved course record</summary>
                <p>
                  {credentialStatusLabel(saved?.status ?? "")} ·{" "}
                  {calendarDate(saved?.targetDate ?? null)}
                </p>
                <pre>{saved?.evidenceNote}</pre>
                <pre>{saved?.evidenceReference}</pre>
              </details>
              <button
                className="secondary-button"
                disabled={c.busy || c.pending}
                onClick={() => c.discardDraft(definition.id)}
              >
                Discard local course draft and reload
              </button>
            </div>
          )}
          <div className="credential-form-row">
            <label>
              Personal status
              <select
                aria-label="Personal credential status"
                value={draft?.status ?? "not_started"}
                disabled={blocked || stale}
                onChange={(e) =>
                  update({ status: e.target.value as CredentialStatus })
                }
              >
                {(
                  [
                    "not_started",
                    "in_progress",
                    "on_hold",
                    "completed",
                    "not_pursuing",
                  ] as const
                ).map((status) => (
                  <option value={status} key={status}>
                    {credentialStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Personal target date
              <input
                aria-label="Personal target date"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={draft?.targetDate ?? ""}
                disabled={blocked || stale}
                onChange={(e) => update({ targetDate: e.target.value || null })}
              />
            </label>
          </div>
          <p className="micro-copy">
            Target dates are calendar dates you choose. They do not change
            status automatically or represent provider registration.
          </p>
          {pastTarget && (
            <p className="credential-past-target">
              Your saved personal target is in the past. Status remains{" "}
              {credentialStatusLabel(saved!.status).toLowerCase()} until you
              change it.
            </p>
          )}
          <label className="credential-evidence-label">
            <FileText size={14} />
            Progress & completion evidence
            <textarea
              aria-label="Credential evidence note"
              value={draft?.evidenceNote ?? ""}
              disabled={blocked || stale}
              onChange={(e) => update({ evidenceNote: e.target.value })}
              placeholder="Record actual study progress, the provider outcome, and evidence context. For grouped optional coursework, name the modules you actually completed."
            />
          </label>
          <div className="evidence-editor-footer">
            <span>
              {bytes(draft?.evidenceNote ?? "")} / 20,000 UTF-8 bytes · 20
              characters for completion
            </span>
            <span>
              {!working
                ? "READ-ONLY PLAN"
                : dirty
                  ? "UNSAVED DRAFT"
                  : "SAVED RECORD"}
            </span>
          </div>
          <label className="credential-reference-label">
            Evidence reference{" "}
            <small>
              Optional plain text: certificate reference, file path, commit, or
              URL.
            </small>
            <input
              aria-label="Credential evidence reference"
              value={draft?.evidenceReference ?? ""}
              disabled={blocked || stale}
              onChange={(e) => update({ evidenceReference: e.target.value })}
              placeholder="Reference your actual evidence; no link is fetched or file opened."
            />
          </label>
          <p className="micro-copy">
            Reference size: {bytes(draft?.evidenceReference ?? "")} / 2,048
            UTF-8 bytes. This app stores references as text.
          </p>
          {complete && (
            <label className="credential-completion-ack">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={blocked || stale}
                onChange={(e) =>
                  setAttested(e.target.checked ? signature : null)
                }
              />
              <span>
                I checked the provider’s completion outcome or my selected
                coursework, and I am recording my own completion report.
              </span>
            </label>
          )}
          {complete && !evidenceReady && (
            <p className="credential-validation">
              Add at least 20 characters of concrete evidence context before
              reporting completion.
            </p>
          )}
          {!withinLimits && working && (
            <p className="credential-validation">
              Shorten the evidence note or reference to fit the saved text
              limits.
            </p>
          )}
          <button
            className="primary-button"
            disabled={blocked || !ready}
            onClick={() => {
              if (draft)
                void c.save(definition.id, draft, complete && confirmed);
            }}
          >
            <Save size={14} />
            {c.busy ? "Saving personal report…" : "Save personal course record"}
          </button>
          {saved?.completedAt && (
            <p className="credential-reported-at">
              Completion self-reported on {timestamp(saved.completedAt)}. This
              is the report time, not an official award date.
            </p>
          )}
          <div className="credential-source">
            <h3>Provider reference</h3>
            <code>{definition.url}</code>
            <p>{definition.budgetNote}</p>
            <small>
              Price and availability notes are historical planning assumptions.
              Check current provider requirements before enrolling or
              purchasing.
            </small>
          </div>
        </section>
      </div>
      <section className="panel credential-history">
        <div className="section-heading compact">
          <div>
            <h2>
              <History size={15} />
              Personal tracking history
            </h2>
            <p>
              The latest 100 saved course actions. Previous evidence remains in
              local snapshots and backups.
            </p>
          </div>
          <span className="small-tag">NO EXTERNAL VERIFICATION</span>
        </div>
        {c.summary?.history.length ? (
          c.summary.history.map((h) => (
            <details key={h.requestId}>
              <summary>
                <span>
                  {credentials.find((d) => d.id === h.credentialId)?.title ??
                    h.credentialId}
                  <small>
                    {timestamp(h.createdAt)} ·{" "}
                    {h.action === "catalog_updated"
                      ? "Authored plan updated"
                      : credentialStatusLabel(h.snapshot.status)}
                  </small>
                </span>
                <ChevronRight size={14} />
              </summary>
              <div>
                <p>Personal target: {calendarDate(h.snapshot.targetDate)}</p>
                <pre>
                  {h.snapshot.evidenceNote ||
                    "No evidence note saved with this update."}
                </pre>
                {h.snapshot.evidenceReference && (
                  <code>{h.snapshot.evidenceReference}</code>
                )}
                {h.snapshot.completedAt && (
                  <p>
                    Completion report recorded:{" "}
                    {timestamp(h.snapshot.completedAt)}
                  </p>
                )}
              </div>
            </details>
          ))
        ) : (
          <p className="empty-copy">
            {c.summary
              ? "No personal course records have been changed yet."
              : "Saved course history is unavailable."}
          </p>
        )}
      </section>
    </>
  );
}
