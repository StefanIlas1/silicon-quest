import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { native, errorMessage } from "./backend";
import { FocusContext, emptyFocusSummary } from "./Focus";
import type { FocusSessionView, FocusSummaryView } from "./Focus";
export type FocusSession = {
  id: string;
  topicId: string;
  status: "active" | "completed" | "interrupted";
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
  elapsedSeconds: number;
  sequence: number;
  excludedGapCount: number;
};
export type FocusSummary = {
  activeSession: FocusSession | null;
  sessions: FocusSession[];
  totalSeconds: number;
  completedSessions: number;
  interruptedSessions: number;
  todaySeconds: number;
  todayDate: string;
  topicSeconds: { topicId: string; seconds: number }[];
  canControl: boolean;
};
type Action = {
  name:
    | "start_focus_session"
    | "tick_focus_session"
    | "end_focus_session"
    | "get_focus_summary";
  args?: Record<string, unknown>;
};
const viewSession = (s: FocusSession): FocusSessionView => ({
  ...s,
  durationSeconds: s.elapsedSeconds,
});
export function focusView(summary: FocusSummary): FocusSummaryView {
  return {
    activeSession: summary.activeSession
      ? viewSession(summary.activeSession)
      : null,
    sessions: summary.sessions.map(viewSession),
    totalSeconds: summary.totalSeconds,
    totalSessions:
      summary.completedSessions +
      summary.interruptedSessions +
      (summary.activeSession ? 1 : 0),
    todaySeconds: summary.todaySeconds,
    todayDate: summary.todayDate,
    byTopic: summary.topicSeconds,
  };
}
export default function FocusProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<FocusSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(native);
  const [error, setError] = useState("");
  const [acknowledgedAt, setAcknowledgedAt] = useState(0);
  const current = useRef<FocusSummary | null>(null);
  const alive = useRef(true);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef<Action | null>(null);
  const heartbeatPending = useRef(false);
  const userPending = useRef(0);
  function accept(snapshot: FocusSummary) {
    current.current = snapshot;
    if (alive.current) {
      setSummary(snapshot);
      setAcknowledgedAt(performance.now());
      setError("");
      setLoading(false);
    }
  }
  async function run(action: Action) {
    if (action.name !== "get_focus_summary") pending.current = action;
    const snapshot = await invoke<FocusSummary>(action.name, action.args);
    if (pending.current === action) pending.current = null;
    accept(snapshot);
  }
  function enqueue(makeAction: () => Action | null, userAction = true) {
    if (!native) return Promise.resolve();
    if (userAction) {
      ++userPending.current;
      if (alive.current) setBusy(true);
    }
    const job = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          if (!alive.current) return;
          if (pending.current) await run(pending.current);
          if (!alive.current) return;
          const action = makeAction();
          if (action) await run(action);
        } catch (e) {
          if (!alive.current) return;
          const code =
            typeof e === "object" && e !== null && "code" in e
              ? String(e.code)
              : "";
          if (
            [
              "invalid_input",
              "invalid_sequence",
              "stale_session",
              "focus_owned_elsewhere",
              "active_session_exists",
            ].includes(code)
          ) {
            // These explicit rejections did not accept the pending mutation.
            // Resolve authoritative state instead of replaying it forever.
            pending.current = null;
            try {
              accept(await invoke<FocusSummary>("get_focus_summary"));
            } catch {
              /* Keep the last confirmed snapshot and original rejection below. */
            }
          }
          if (alive.current) {
            setError(
              `${errorMessage(e)} Only confirmed time is included in your history.`,
            );
            setLoading(false);
          }
        } finally {
          if (userAction) {
            --userPending.current;
            if (alive.current) setBusy(userPending.current > 0);
          }
        }
      });
    queue.current = job;
    return job;
  }
  function begin(topicId: string) {
    const requestId = crypto.randomUUID();
    return enqueue(() =>
      current.current?.canControl && !current.current.activeSession
        ? { name: "start_focus_session", args: { topicId, requestId } }
        : null,
    );
  }
  function finish() {
    return enqueue(() => {
      const active = current.current?.activeSession;
      return active && current.current?.canControl
        ? {
            name: "end_focus_session",
            args: { sessionId: active.id, sequence: active.sequence + 1 },
          }
        : null;
    });
  }
  function refresh() {
    return enqueue(() => ({ name: "get_focus_summary" }));
  }
  useEffect(() => {
    alive.current = true;
    if (native) void enqueue(() => ({ name: "get_focus_summary" }), false);
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!summary?.activeSession) return;
    const timer = setInterval(() => {
      if (heartbeatPending.current || userPending.current) return;
      heartbeatPending.current = true;
      void enqueue(() => {
        const snapshot = current.current;
        const active = snapshot?.activeSession;
        if (!active) return null;
        return snapshot.canControl
          ? {
              name: "tick_focus_session",
              args: { sessionId: active.id, sequence: active.sequence + 1 },
            }
          : { name: "get_focus_summary" };
      }, false).finally(() => {
        heartbeatPending.current = false;
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [summary?.activeSession?.id, summary?.canControl]);
  return (
    <FocusContext.Provider
      value={{
        summary: summary ? focusView(summary) : emptyFocusSummary,
        available: !!summary?.canControl && native,
        readOnly: !!summary && !summary.canControl,
        loading,
        busy,
        error,
        acknowledgedAt,
        begin,
        finish,
        refresh,
      }}
    >
      {children}
    </FocusContext.Provider>
  );
}
