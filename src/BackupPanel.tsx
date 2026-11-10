import { useContext, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Archive,
  ArrowDownToLine,
  CheckCircle2,
  FileCheck2,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { native, errorMessage } from "./backend";
import { durationLabel, useFocus } from "./Focus";
import { RestoreContext } from "./restoreContext";
export type BackupCounts = {
  topics: number;
  attempts: number;
  notes: number;
  pdfs: number;
  pdfBytes: number;
  focusSessions: number;
  trackedSeconds: number;
  reviewTopics: number;
  totalXp: number;
  projectMilestones?: number;
  reviewedMilestones?: number;
  projectEvidenceNotes?: number;
};
export type BackupPreview = {
  previewToken: string;
  fileName: string;
  createdAt: string | null;
  sourceSchemaVersion: number;
  currentSchemaVersion: number;
  bytes: number;
  counts: BackupCounts;
  interruptedSessions: number;
};
export type RestoreResult = {
  restored: true;
  restartRequired: true;
  safetyBackupFileName: string;
  safetyBackupPath?: string;
  counts: BackupCounts;
};
export type BackupStatus = {
  restartRequired: boolean;
  workspaceReplaced: boolean;
  safetyBackupPath: string | null;
};
export type RestartState = RestoreResult | BackupStatus;
type ExportResult = { fileName: string; bytes: number; createdAt: string };
type Operation =
  "export" | "inspect" | "discard" | "restore" | "restart" | null;
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Creation time unavailable";
export default function BackupPanel({
  unsavedNotes = 0,
  unsavedProjectDrafts = 0,
  otherOperationBusy = false,
}: {
  unsavedNotes?: number;
  unsavedProjectDrafts?: number;
  otherOperationBusy?: boolean;
}) {
  const focus = useFocus();
  const notifyRestored = useContext(RestoreContext);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [restored, setRestored] = useState<RestartState | null>(null);
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const previewRef = useRef<BackupPreview | null>(null);
  const restoredRef = useRef(false);
  const alive = useRef(true);
  const activeFocus = focus.summary.activeSession;
  const blocked = !native || !!operation || otherOperationBusy || focus.busy;
  function showRestart(result: RestartState) {
    restoredRef.current = true;
    previewRef.current = null;
    if (alive.current) {
      setRestored(result);
      setPreview(null);
      notifyRestored?.(result);
    }
  }
  async function recoverStatus() {
    const status = await invoke<BackupStatus>("get_backup_status");
    if (status.restartRequired) {
      showRestart(status);
      return true;
    }
    return false;
  }
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  useEffect(() => {
    alive.current = true;
    if (native)
      void recoverStatus().catch((e) => {
        if (alive.current)
          setError(
            `Could not check local workspace status: ${errorMessage(e)}`,
          );
      });
    return () => {
      alive.current = false;
      if (previewRef.current && !restoredRef.current)
        void invoke("discard_backup_preview", {
          previewToken: previewRef.current.previewToken,
        }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!preview) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !operation && !restored) {
        e.preventDefault();
        void discard();
      }
      if (e.key === "Tab" && dialog.current) {
        const nodes = [
          ...dialog.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
          ),
        ];
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (!first) {
          e.preventDefault();
          dialog.current.focus();
        } else if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog.current ||
            !dialog.current.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === dialog.current ||
            !dialog.current.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", keyboard);
    };
  }, [!!preview, operation]);
  async function exportBackup() {
    if (blocked) return;
    setOperation("export");
    setError("");
    setNotice("");
    try {
      const result = await invoke<ExportResult | null>("export_local_backup");
      if (alive.current)
        setNotice(
          result
            ? `Saved ${result.fileName} · ${fileSize(result.bytes)} · ${date(result.createdAt)}`
            : "Backup export cancelled.",
        );
    } catch (e) {
      if (alive.current)
        setError(`Backup export could not be confirmed: ${errorMessage(e)}`);
    } finally {
      if (alive.current) setOperation(null);
    }
  }
  async function inspect() {
    if (blocked) return;
    setOperation("inspect");
    setError("");
    setNotice("");
    setAcknowledged(false);
    setRestoreAttempted(false);
    try {
      const result = await invoke<BackupPreview | null>("inspect_local_backup");
      if (alive.current) {
        previewRef.current = result;
        setPreview(result);
        setNotice(result ? "" : "No backup selected.");
      } else if (result)
        void invoke("discard_backup_preview", {
          previewToken: result.previewToken,
        }).catch(() => {});
    } catch (e) {
      if (alive.current)
        setError(`Could not inspect this backup: ${errorMessage(e)}`);
    } finally {
      if (alive.current) setOperation(null);
    }
  }
  async function discard() {
    if (operation || restored || !preview) return;
    setOperation("discard");
    setError("");
    try {
      await invoke("discard_backup_preview", {
        previewToken: preview.previewToken,
      });
      if (alive.current) {
        previewRef.current = null;
        setPreview(null);
        setAcknowledged(false);
        setRestoreAttempted(false);
        setNotice("Restore cancelled. No replacement was requested.");
      }
    } catch (e) {
      if (alive.current)
        setError(`Could not close the staged preview: ${errorMessage(e)}`);
    } finally {
      if (alive.current) setOperation(null);
    }
  }
  async function restore() {
    if (blocked || focus.loading || activeFocus || !preview || !acknowledged)
      return;
    setOperation("restore");
    setRestoreAttempted(true);
    setError("");
    try {
      const result = await invoke<RestoreResult>("restore_local_backup", {
        previewToken: preview.previewToken,
      });
      if (!result.restored || !result.restartRequired)
        throw new Error("The restore acknowledgement was incomplete.");
      showRestart(result);
    } catch (e) {
      try {
        if (await recoverStatus()) return;
      } catch {
        /* The same preview remains available for an explicit retry. */
      }
      if (alive.current)
        setError(
          `Restore was not confirmed: ${errorMessage(e)} Retry this same preview to resolve the operation.`,
        );
    } finally {
      if (alive.current) setOperation(null);
    }
  }

  return (
    <section className="panel backup-panel">
      <div className="backup-heading">
        <span className="track-icon">
          <Archive size={23} />
        </span>
        <div>
          <span className="eyebrow">A COPY YOU CONTROL</span>
          <h2>Local backups & restore</h2>
          <p>
            Keep a portable copy of saved learning data and your imported PDFs.
          </p>
        </div>
        <span className="small-tag">NO CLOUD TRANSFER</span>
      </div>
      <div className="backup-actions-grid">
        <div>
          <ArrowDownToLine size={24} />
          <h3>Save a local backup</h3>
          <p>
            Choose where to save a consistent SQLite snapshot: progress, notes,
            PDFs, quiz and review history, project evidence, and confirmed focus
            time.
          </p>
          <button
            className="secondary-button"
            disabled={blocked}
            onClick={exportBackup}
          >
            <ArrowDownToLine size={14} />
            {operation === "export"
              ? "Creating backup…"
              : "Export local backup"}
          </button>
        </div>
        <div>
          <RotateCcw size={24} />
          <h3>Restore from a backup</h3>
          <p>
            Choose a Silicon Quest SQLite backup (up to 2 GiB) to inspect first.
            Review its saved contents and confirm before replacing this app’s
            local data.
          </p>
          <button
            className="secondary-button"
            disabled={blocked}
            onClick={inspect}
          >
            <FolderOpen size={14} />
            {operation === "inspect"
              ? "Inspecting backup…"
              : "Choose backup to inspect"}
          </button>
        </div>
      </div>
      <div className="backup-boundary">
        <ShieldCheck size={15} />
        <p>
          Backup files are <strong>not encrypted</strong> and include saved PDFs
          and notes. These controls use local file dialogs and send nothing to a
          cloud service. Only saved data is included.
        </p>
      </div>
      {unsavedNotes > 0 && (
        <p className="backup-draft-warning">
          {unsavedNotes} {unsavedNotes === 1 ? "topic has" : "topics have"}{" "}
          unsaved note drafts. Save them in their study workspaces before
          exporting. Restoring discards unsaved drafts.
        </p>
      )}
      {activeFocus && (
        <p className="backup-draft-warning">
          A focus session is active. Exports include confirmed checkpoints only;
          finish this session before restoring.
        </p>
      )}
      {unsavedProjectDrafts > 0 && (
        <p className="backup-draft-warning">
          {unsavedProjectDrafts} project{" "}
          {unsavedProjectDrafts === 1 ? "milestone has" : "milestones have"}{" "}
          unsaved task, evidence, or review drafts. Only saved project records
          are exported; restoring discards these drafts.
        </p>
      )}
      {otherOperationBusy && (
        <p className="micro-copy">
          Wait for the current learning action to finish before using backup
          controls.
        </p>
      )}
      {!native && (
        <p className="backup-unavailable">
          Backups require the desktop app. This browser preview cannot export or
          replace a local database.
        </p>
      )}
      {notice && (
        <p className="backup-notice" role="status">
          <CheckCircle2 size={14} />
          {notice}
        </p>
      )}
      {error && !preview && !restored && (
        <p className="backup-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="modal-backdrop backup-backdrop">
          <div
            className="backup-dialog"
            ref={dialog}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-dialog-title"
          >
            <>
              <div className="quiz-header">
                <span className="eyebrow">
                  <FileCheck2 size={14} />
                  INSPECTED LOCAL BACKUP
                </span>
                <button
                  className="icon-button"
                  aria-label="Cancel restore preview"
                  disabled={!!operation}
                  onClick={discard}
                >
                  <X size={19} />
                </button>
              </div>
              <h2 id="backup-dialog-title">Review before replacing data.</h2>
              <p>
                Restoring <strong>{preview!.fileName}</strong> replaces all
                current saved learning data and PDFs. It does not merge two
                learning histories.
              </p>
              <div className="backup-file-details">
                <span>{fileSize(preview!.bytes)}</span>
                <span>{date(preview!.createdAt)}</span>
                <span>
                  Schema {preview!.sourceSchemaVersion} →{" "}
                  {preview!.currentSchemaVersion}
                </span>
              </div>
              <div className="backup-preview-counts">
                {[
                  {
                    label: "Tracked topic records",
                    value: preview!.counts.topics,
                  },
                  { label: "Quiz attempts", value: preview!.counts.attempts },
                  {
                    label: "Saved note entries",
                    value: preview!.counts.notes,
                  },
                  {
                    label: "Imported PDFs",
                    value: `${preview!.counts.pdfs} · ${fileSize(preview!.counts.pdfBytes)}`,
                  },
                  {
                    label: "Focus sessions",
                    value: preview!.counts.focusSessions,
                  },
                  {
                    label: "Confirmed focus",
                    value: durationLabel(preview!.counts.trackedSeconds),
                  },
                  {
                    label: "Review schedules",
                    value: preview!.counts.reviewTopics,
                  },
                  { label: "Saved XP", value: preview!.counts.totalXp },
                  ...(preview!.counts.projectMilestones !== undefined
                    ? [
                        {
                          label: "Saved milestone entries",
                          value: preview!.counts.projectMilestones,
                        },
                        {
                          label: "Self-reviewed milestones",
                          value:
                            preview!.counts.reviewedMilestones ?? "Unavailable",
                        },
                        {
                          label: "Project evidence notes",
                          value:
                            preview!.counts.projectEvidenceNotes ??
                            "Unavailable",
                        },
                      ]
                    : []),
                ].map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
              {preview!.interruptedSessions > 0 && (
                <p className="backup-draft-warning">
                  This backup contains {preview!.interruptedSessions} active
                  focus{" "}
                  {preview!.interruptedSessions === 1 ? "session" : "sessions"}.
                  They will be marked interrupted and retain confirmed
                  checkpoints only.
                </p>
              )}
              <div className="backup-restore-policy">
                <ShieldCheck size={16} />
                <p>
                  A safety copy of the current saved database is created before
                  replacement. A restart is required after restore. Active focus
                  sessions in the backup become interrupted records with their
                  saved checkpoints; no offline time is added.
                </p>
              </div>
              {unsavedNotes > 0 && (
                <p className="backup-draft-warning">
                  You currently have {unsavedNotes} unsaved note{" "}
                  {unsavedNotes === 1 ? "draft" : "drafts"}. Restoring and
                  restarting discards them.
                </p>
              )}
              {unsavedProjectDrafts > 0 && (
                <p className="backup-draft-warning">
                  You also have {unsavedProjectDrafts} project{" "}
                  {unsavedProjectDrafts === 1
                    ? "milestone with unsaved changes"
                    : "milestones with unsaved changes"}
                  . These session-only drafts are discarded by restore.
                </p>
              )}
              {activeFocus && (
                <div className="backup-active-focus">
                  <p>Finish the active focus session before restoring.</p>
                  {focus.available && (
                    <button
                      className="secondary-button"
                      disabled={focus.busy || !!operation}
                      onClick={focus.finish}
                    >
                      <Square size={12} />
                      {focus.busy
                        ? "Finishing…"
                        : "Finish active focus session"}
                    </button>
                  )}
                  {!focus.available && (
                    <small>
                      Finish it in the app instance that owns focus recording.
                    </small>
                  )}
                </div>
              )}
              <label className="backup-confirmation">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={!!operation}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  I understand this replaces the current saved data, including
                  PDFs, discards unsaved drafts, and requires an app restart.
                </span>
              </label>
              {error && (
                <p className="backup-error" role="alert">
                  {error}
                </p>
              )}
              <div className="backup-confirm-actions">
                <button
                  className="secondary-button"
                  disabled={!!operation}
                  onClick={discard}
                >
                  {operation === "discard"
                    ? "Closing preview…"
                    : "Cancel restore"}
                </button>
                <button
                  className="restore-button"
                  disabled={
                    blocked || focus.loading || !!activeFocus || !acknowledged
                  }
                  onClick={restore}
                >
                  <RotateCcw size={14} />
                  {operation === "restore"
                    ? "Restoring saved data…"
                    : restoreAttempted
                      ? "Retry restore confirmation"
                      : "Replace local data"}
                </button>
              </div>
              <p className="micro-copy">
                This validated preview expires after 15 minutes.{" "}
                {restoreAttempted
                  ? "No additional replacement is assumed until the backend confirms it."
                  : "Inspecting this file has not replaced your current data."}
              </p>
            </>
          </div>
        </div>
      )}
      {restored && <RestoredBackupScreen restored={restored} />}
    </section>
  );
}

export function RestoredBackupScreen({ restored }: { restored: RestartState }) {
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const dialog = useRef<HTMLDivElement>(null);
  const committed = "restored" in restored;
  const safetyPath =
    restored.safetyBackupPath ??
    ("safetyBackupFileName" in restored ? restored.safetyBackupFileName : null);
  useEffect(() => {
    alive.current = true;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        dialog.current
          ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
          ?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      alive.current = false;
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", trap);
    };
  }, []);
  async function restart() {
    if (operation || !restored) return;
    setOperation("restart");
    setError("");
    try {
      await invoke("restart_after_restore");
    } catch (e) {
      if (alive.current) {
        setError(
          `Could not restart automatically: ${errorMessage(e)} Quit and reopen Silicon Quest to load the restored data.`,
        );
        setOperation(null);
      }
    }
  }
  return (
    <div className="modal-backdrop backup-backdrop">
      <div
        className="backup-dialog"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-dialog-title"
      >
        <>
          <div className="backup-dialog-eyebrow">
            <CheckCircle2 size={18} />
            {committed ? "RESTORE COMMITTED" : "WORKSPACE RESTART REQUIRED"}
          </div>
          <h2 id="backup-dialog-title">
            {committed ? "Your backup is restored." : "Local data changed."}
            <br />
            Restart to use it.
          </h2>
          <p>
            The saved database has been replaced. Data actions are blocked until
            a full app restart so older pending actions cannot modify the
            restored records.
          </p>
          {safetyPath && (
            <div className="backup-recovery">
              <strong>Your previous saved data has a safety copy.</strong>
              <code>{safetyPath}</code>
              <small>
                Keep this recovery copy until you have checked the restored app.
              </small>
            </div>
          )}
          {"counts" in restored && (
            <div className="backup-restored-counts">
              <span>{restored.counts.attempts} quiz attempts</span>
              <span>{restored.counts.pdfs} PDFs</span>
              <span>{restored.counts.notes} saved note entries</span>
            </div>
          )}
          {error && (
            <p className="backup-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-button"
            disabled={!!operation}
            onClick={restart}
          >
            <RefreshCw size={15} />
            {operation === "restart"
              ? "Restarting app…"
              : "Restart Silicon Quest"}
          </button>
          <p className="micro-copy">
            Unsaved drafts are not part of the restored data. If automatic
            restart is unavailable, quit and reopen the app manually.
          </p>
        </>
      </div>
    </div>
  );
}
