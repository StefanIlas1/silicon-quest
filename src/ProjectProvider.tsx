import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { native, errorMessage } from "./backend";
import type { Dashboard } from "./backend";
import { projectMilestones } from "../curriculum/data";
export type ProjectStatus =
  "not_started" | "in_progress" | "ready_for_review" | "completed";
export type TaskCheck = { taskId: string; done: boolean };
export type MilestoneProgress = {
  milestoneId: string;
  status: ProjectStatus;
  taskChecks: TaskCheck[];
  evidenceNote: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  updatedAt: string | null;
  version: number;
};
export type ProjectProgress = {
  projectId: string;
  status: "not_started" | "in_progress" | "completed";
  requiredMilestones: number;
  completedRequiredMilestones: number;
  optionalMilestones: number;
  completedOptionalMilestones: number;
};
export type ProjectAction = {
  requestId: string;
  milestoneId: string;
  action: "saved" | "reviewed" | "reopened" | "invalidated";
  createdAt: string;
  xpAwarded: number;
  reason: string | null;
  snapshot: MilestoneProgress;
  definition?: { projectId: string; title: string; doneWhen: string };
};
export type ProjectSummary = {
  projects: ProjectProgress[];
  milestones: MilestoneProgress[];
  totalRequiredMilestones: number;
  completedRequiredMilestones: number;
  totalXpEarned: number;
  history: ProjectAction[];
};
export type ProjectMutation = {
  summary: ProjectSummary;
  dashboard: Dashboard;
  milestoneId: string;
  xpAwarded: number;
  replayed: boolean;
};
export type ProjectDraft = {
  taskChecks: TaskCheck[];
  evidenceNote: string;
  status: Exclude<ProjectStatus, "completed">;
  reviewNote: string;
  reopenReason: string;
  baseVersion: number;
};
type MutationName =
  | "save_project_milestone"
  | "review_project_milestone"
  | "reopen_project_milestone";
type Pending = {
  name: MutationName;
  args: Record<string, unknown>;
  milestoneId: string;
};
type ProjectSelection = {
  projectId: string | null;
  milestoneId: string | null;
};
type ProjectControl = {
  summary: ProjectSummary | null;
  dashboard: Dashboard | null;
  loading: boolean;
  busy: boolean;
  error: string;
  notice: string;
  pending: boolean;
  unsavedDraftCount: number;
  selection: ProjectSelection;
  setSelection: (value: ProjectSelection) => void;
  drafts: Record<string, ProjectDraft>;
  setDraft: (id: string, value: ProjectDraft) => void;
  discardDraft: (id: string) => void;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
  save: (id: string, draft: ProjectDraft) => Promise<void>;
  review: (id: string, draft: ProjectDraft) => Promise<void>;
  reopen: (id: string, draft: ProjectDraft) => Promise<void>;
};
const inactive: ProjectControl = {
  summary: null,
  dashboard: null,
  loading: false,
  busy: false,
  error: "",
  notice: "",
  pending: false,
  unsavedDraftCount: 0,
  selection: { projectId: null, milestoneId: null },
  setSelection: () => {},
  drafts: {},
  setDraft: () => {},
  discardDraft: () => {},
  refresh: async () => {},
  retry: async () => {},
  save: async () => {},
  review: async () => {},
  reopen: async () => {},
};
const ProjectContext = createContext<ProjectControl>(inactive);
export const useProjects = () => useContext(ProjectContext);
export function savedProjectDraft(
  progress: MilestoneProgress,
  tasks: readonly { id: string }[],
): ProjectDraft {
  return {
    taskChecks: tasks.map((t) => ({
      taskId: t.id,
      done: progress.taskChecks.find((c) => c.taskId === t.id)?.done ?? false,
    })),
    evidenceNote: progress.evidenceNote,
    status: progress.status === "completed" ? "in_progress" : progress.status,
    reviewNote: "",
    reopenReason: "",
    baseVersion: progress.version,
  };
}
export function progressDraftChanged(draft: ProjectDraft, saved: ProjectDraft) {
  return (
    draft.status !== saved.status ||
    draft.evidenceNote !== saved.evidenceNote ||
    JSON.stringify(draft.taskChecks) !== JSON.stringify(saved.taskChecks)
  );
}
export default function ProjectProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<ProjectSelection>({
    projectId: null,
    milestoneId: null,
  });
  const [summary, setSummary] = useState<ProjectSummary | null>(null),
    [dashboard, setDashboard] = useState<Dashboard | null>(null),
    [loading, setLoading] = useState(native),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [drafts, setDrafts] = useState<Record<string, ProjectDraft>>({}),
    [hasPending, setHasPending] = useState(false);
  const alive = useRef(true),
    pending = useRef<Pending | null>(null),
    busyRef = useRef(false),
    generation = useRef(0),
    request = useRef(0);
  function setDraft(id: string, draft: ProjectDraft) {
    setDrafts((old) => ({ ...old, [id]: draft }));
  }
  function discardDraft(id: string) {
    setError("");
    setNotice("Local draft discarded; the current saved milestone is loaded.");
    setDrafts((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
  }
  async function refresh() {
    if (!native) return;
    const version = generation.current,
      id = ++request.current;
    if (alive.current) setLoading(true);
    try {
      const next = await invoke<ProjectSummary>("get_project_summary");
      if (
        alive.current &&
        version === generation.current &&
        id === request.current
      ) {
        setSummary(next);
        if (!pending.current) setError("");
      }
    } catch (e) {
      if (
        alive.current &&
        version === generation.current &&
        id === request.current
      )
        setError(errorMessage(e));
    } finally {
      if (alive.current && id === request.current) setLoading(false);
    }
  }
  async function execute(action: Pending) {
    if (!native || busyRef.current) return;
    busyRef.current = true;
    pending.current = action;
    if (alive.current) {
      setBusy(true);
      setHasPending(true);
      setError("");
      setNotice("");
    }
    try {
      const result = await invoke<ProjectMutation>(action.name, action.args);
      pending.current = null;
      ++generation.current;
      if (!alive.current) return;
      setHasPending(false);
      setError("");
      setSummary(result.summary);
      setDashboard(result.dashboard);
      setLoading(false);
      const returned = result.summary.milestones.find(
        (m) => m.milestoneId === action.milestoneId,
      );
      const newerState =
        !!returned &&
        returned.version > Number(action.args.expectedVersion) + 1;
      setDrafts((old) => {
        // A replay/current summary may include somebody else's later edit.
        // Keep the original draft and version for explicit comparison.
        if (newerState) return old;
        const next = { ...old };
        const previous = next[action.milestoneId],
          saved = result.summary.milestones.find(
            (m) => m.milestoneId === action.milestoneId,
          );
        if (
          action.name === "save_project_milestone" &&
          previous &&
          saved &&
          (previous.reviewNote || previous.reopenReason)
        ) {
          next[action.milestoneId] = {
            ...previous,
            taskChecks: saved.taskChecks,
            evidenceNote: saved.evidenceNote,
            status: saved.status === "completed" ? "in_progress" : saved.status,
            baseVersion: saved.version,
          };
        } else delete next[action.milestoneId];
        return next;
      });
      setNotice(
        newerState
          ? "Your action was recorded, and this milestone changed again. Compare the saved state with your preserved draft."
          : result.replayed
            ? "Earlier action confirmed; no duplicate reward was recorded."
            : action.name === "review_project_milestone"
              ? `Self-review saved.${result.xpAwarded ? ` +${result.xpAwarded} XP earned once.` : " Prior milestone XP is retained."}`
              : action.name === "reopen_project_milestone"
                ? "Milestone reopened for work. Earlier XP and history are retained."
                : "Progress and evidence saved locally.",
      );
    } catch (e) {
      if (!alive.current) return;
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? String(e.code)
          : "";
      if (
        [
          "invalid_input",
          "invalid_project_input",
          "stale_project_state",
          "version_conflict",
          "project_conflict",
          "stale_version",
          "milestone_conflict",
        ].includes(code)
      ) {
        pending.current = null;
        setHasPending(false);
        await refresh();
      }
      setError(
        `${errorMessage(e)} ${pending.current ? "Retry the same pending action before editing further." : "Your local draft has been preserved."}`,
      );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function submit(
    name: MutationName,
    id: string,
    args: Record<string, unknown>,
  ) {
    if (pending.current) return execute(pending.current);
    return execute({
      name,
      milestoneId: id,
      args: { milestoneId: id, ...args, requestId: crypto.randomUUID() },
    });
  }
  const save = (id: string, d: ProjectDraft) =>
    submit("save_project_milestone", id, {
      taskChecks: d.taskChecks,
      evidenceNote: d.evidenceNote,
      status: d.status,
      expectedVersion: d.baseVersion,
    });
  const review = (id: string, d: ProjectDraft) =>
    submit("review_project_milestone", id, {
      reviewNote: d.reviewNote,
      confirmReviewed: true,
      expectedVersion: d.baseVersion,
    });
  const reopen = (id: string, d: ProjectDraft) =>
    submit("reopen_project_milestone", id, {
      reason: d.reopenReason,
      expectedVersion: d.baseVersion,
    });
  async function retry() {
    if (pending.current) await execute(pending.current);
  }
  useEffect(() => {
    alive.current = true;
    if (native) void refresh();
    return () => {
      alive.current = false;
    };
  }, []);
  const unsavedDraftCount = Object.entries(drafts).filter(([id, d]) => {
    const saved = summary?.milestones.find((m) => m.milestoneId === id),
      def = projectMilestones.find((m) => m.id === id);
    return (
      !saved ||
      !def ||
      progressDraftChanged(d, savedProjectDraft(saved, def.tasks)) ||
      d.reviewNote.trim() ||
      d.reopenReason.trim()
    );
  }).length;
  return (
    <ProjectContext.Provider
      value={{
        summary,
        dashboard,
        loading,
        busy,
        error,
        notice,
        pending: hasPending,
        unsavedDraftCount,
        selection,
        setSelection,
        drafts,
        setDraft,
        discardDraft,
        refresh,
        retry,
        save,
        review,
        reopen,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
