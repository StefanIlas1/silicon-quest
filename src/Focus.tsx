import { createContext, useContext, useEffect, useState } from "react";
import {
  ArrowRight,
  Clock3,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Timer,
} from "lucide-react";
import { modules } from "../curriculum/data";
import { native } from "./backend";

export type FocusSessionView = {
  id: string;
  topicId: string;
  status: "active" | "completed" | "interrupted";
  durationSeconds: number;
  startedAt: string;
  endedAt: string | null;
  excludedGapCount: number;
};
export type FocusSummaryView = {
  activeSession: FocusSessionView | null;
  sessions: FocusSessionView[];
  totalSeconds: number;
  totalSessions: number;
  todaySeconds: number;
  todayDate: string;
  byTopic: { topicId: string; seconds: number }[];
};
export type FocusControl = {
  summary: FocusSummaryView;
  available: boolean;
  readOnly: boolean;
  loading: boolean;
  busy: boolean;
  error: string;
  acknowledgedAt: number;
  begin: (topicId: string) => Promise<void>;
  finish: () => Promise<void>;
  refresh: () => Promise<void>;
};
export const emptyFocusSummary: FocusSummaryView = {
  activeSession: null,
  sessions: [],
  totalSeconds: 0,
  totalSessions: 0,
  todaySeconds: 0,
  todayDate: "",
  byTopic: [],
};
const inactive: FocusControl = {
  summary: emptyFocusSummary,
  available: false,
  readOnly: false,
  loading: false,
  busy: false,
  error: "",
  acknowledgedAt: 0,
  begin: async () => {},
  finish: async () => {},
  refresh: async () => {},
};
export const FocusContext = createContext<FocusControl>(inactive);
export const useFocus = () => useContext(FocusContext);
export function durationLabel(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  const h = Math.floor(n / 3600),
    m = Math.floor((n % 3600) / 60),
    s = n % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}
export function clockLabel(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return [Math.floor(n / 3600), Math.floor((n % 3600) / 60), n % 60]
    .filter((_, i) => i > 0 || n >= 3600)
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
function topicTitle(id: string) {
  return modules.find((m) => m.id === id)?.title ?? id;
}
function LiveClock() {
  const { summary, acknowledgedAt, error } = useFocus();
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = summary.activeSession?.durationSeconds ?? 0;
  const pending = error
    ? 0
    : Math.min(10, Math.max(0, Math.floor((now - acknowledgedAt) / 1000)));
  return <span>{clockLabel(elapsed + pending)}</span>;
}

export function FocusSummary({ onOpen }: { onOpen: () => void }) {
  const c = useFocus();
  return (
    <section className="focus-summary panel">
      <div className="focus-summary-heading">
        <span className="track-icon">
          <Clock3 size={21} />
        </span>
        <div>
          <h2>Make room for deep work.</h2>
          <p>Time is a learning signal. Understanding earns the XP.</p>
        </div>
        <button className="text-button" onClick={onOpen}>
          Focus log
          <ArrowRight size={14} />
        </button>
      </div>
      <div className="focus-summary-stats">
        <div>
          <strong>{durationLabel(c.summary.totalSeconds)}</strong>
          <span>CONFIRMED FOCUS</span>
        </div>
        <div>
          <strong>{c.summary.totalSessions}</strong>
          <span>RECORDED SESSIONS</span>
        </div>
        <div>
          <strong>{durationLabel(c.summary.todaySeconds)}</strong>
          <span>TODAY · UTC</span>
        </div>
      </div>
      {!c.available && (
        <p className="micro-copy">
          {c.loading
            ? "Loading local focus history…"
            : c.readOnly
              ? "Another app instance controls focus tracking. This view is read-only."
              : native
                ? "Focus storage is unavailable. No time is being recorded."
                : "Open the desktop app to record focus sessions."}
        </p>
      )}
    </section>
  );
}

export function FocusTopicControl({ topicId }: { topicId: string }) {
  const c = useFocus();
  const active = c.summary.activeSession;
  return (
    <section className="topic-focus">
      <div className="card-topline">
        <span className="eyebrow">
          <Timer size={13} />
          FOCUS SESSION
        </span>
        {active && <span className="focus-live-indicator">ACTIVE</span>}
      </div>
      {active ? (
        <>
          <h3>
            {active.topicId === topicId
              ? "Give this idea your attention."
              : `Tracking: ${topicTitle(active.topicId)}`}
          </h3>
          <div className="focus-topic-clock">
            <LiveClock />
            <button
              className="secondary-button"
              disabled={c.busy || !c.available}
              onClick={c.finish}
            >
              <Square size={11} />
              Finish session
            </button>
          </div>
          <p className="micro-copy">
            {durationLabel(active.durationSeconds)} confirmed locally. Finish
            before starting another topic.
          </p>
        </>
      ) : (
        <>
          <p>Start when you study. Finish when you are done.</p>
          <button
            className="secondary-button"
            disabled={!c.available || c.busy}
            onClick={() => c.begin(topicId)}
          >
            <Play size={12} />
            {c.busy ? "Starting…" : "Start focus session"}
          </button>
        </>
      )}
      <small>Time tracking never awards XP or mastery.</small>
      {c.error && (
        <p className="focus-inline-error" role="alert">
          {c.error}
        </p>
      )}
    </section>
  );
}

export function FocusMini({ onOpen }: { onOpen: () => void }) {
  const c = useFocus();
  if (!c.summary.activeSession) return null;
  return (
    <button className="focus-mini" onClick={onOpen}>
      <span className="pulse-dot" />
      <span>
        Focus in progress
        <small>{topicTitle(c.summary.activeSession.topicId)}</small>
      </span>
      <strong>
        <LiveClock />
      </strong>
    </button>
  );
}

export function FocusPage() {
  const c = useFocus();
  const [selected, setSelected] = useState(modules[0].id);
  const active = c.summary.activeSession;
  const trackTotals = new Map<string, number>();
  for (const entry of c.summary.byTopic) {
    const track = modules.find((m) => m.id === entry.topicId)?.track ?? "Other";
    trackTotals.set(track, (trackTotals.get(track) ?? 0) + entry.seconds);
  }
  const tracks = [...trackTotals].sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="tiny-line" />
            ATTENTION, WITH INTENTION
          </div>
          <h1>A little focus compounds.</h1>
          <p>
            Record the time you actually spend learning. Keep the evidence of
            understanding separate.
          </p>
        </div>
      </div>
      <div className="focus-page-grid">
        <section className="focus-session-card panel">
          <div className="card-topline">
            <span className="eyebrow">
              <Timer size={14} />
              {active ? "SESSION IN PROGRESS" : "YOUR NEXT FOCUS SESSION"}
            </span>
            {active && <span className="focus-live-indicator">ACTIVE</span>}
          </div>
          {active ? (
            <>
              <h2>{topicTitle(active.topicId)}</h2>
              <div className="focus-big-clock">
                <LiveClock />
              </div>
              {active.excludedGapCount > 0 && (
                <p className="focus-gap-note">
                  {active.excludedGapCount} long or unreliable time{" "}
                  {active.excludedGapCount === 1
                    ? "interval was"
                    : "intervals were"}{" "}
                  excluded.
                </p>
              )}
              <p className="confirmed-duration">
                <ShieldCheck size={13} />
                {durationLabel(active.durationSeconds)} confirmed and saved
                locally
              </p>
              <button
                className="primary-button"
                disabled={c.busy || !c.available}
                onClick={c.finish}
              >
                <Square size={13} />
                {c.busy ? "Finishing…" : "Finish session"}
              </button>
              <p className="micro-copy">
                The live clock includes a short unsaved interval. History and
                totals use confirmed checkpoints only.
              </p>
            </>
          ) : (
            <>
              <h2>One topic. Your full attention.</h2>
              <p>
                Choose a topic before you begin. The timer works while you read,
                experiment, or write code.
              </p>
              <label className="focus-topic-select">
                STUDY TOPIC
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {modules.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-button"
                disabled={!c.available || c.busy}
                onClick={() => c.begin(selected)}
              >
                <Play size={14} />
                {c.busy ? "Starting…" : "Start focus session"}
              </button>
            </>
          )}
          <div className="focus-rule">
            <ShieldCheck size={14} />
            <span>
              Timer duration grants <strong>zero XP</strong> and makes no
              mastery claim. Interrupted sessions retain only confirmed time;
              closed-app time is never inferred.
            </span>
          </div>
          {!c.available && (
            <p className="focus-unavailable">
              {c.loading
                ? "Connecting to local focus storage…"
                : c.readOnly
                  ? "Another app instance controls focus recording. You can review this history here."
                  : native
                    ? "Local focus tracking is unavailable."
                    : "Focus tracking requires the desktop app. This preview records no time."}
            </p>
          )}
          {c.error && (
            <div className="focus-error" role="alert">
              <p>{c.error}</p>
              <button
                className="text-button"
                disabled={c.busy}
                onClick={c.refresh}
              >
                <RefreshCw size={12} />
                Retry connection
              </button>
            </div>
          )}
        </section>
        <section className="focus-totals-card panel">
          <div className="eyebrow">CONFIRMED LEARNING TIME</div>
          <strong>{durationLabel(c.summary.totalSeconds)}</strong>
          <p>
            across {c.summary.totalSessions} recorded{" "}
            {c.summary.totalSessions === 1 ? "session" : "sessions"}
          </p>
          <div className="focus-tracks">
            {tracks.length ? (
              tracks.map(([track, seconds]) => (
                <div key={track}>
                  <div>
                    <span>{track}</span>
                    <strong>{durationLabel(seconds)}</strong>
                  </div>
                  <div className="progress-bar">
                    <span
                      style={{
                        width: `${c.summary.totalSeconds ? (seconds / c.summary.totalSeconds) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="focus-no-data">
                <Clock3 size={24} />
                <p>Your first session will start the picture.</p>
              </div>
            )}
          </div>
        </section>
      </div>
      <section className="panel focus-policy-panel">
        <div className="section-heading compact">
          <div>
            <h2>Keep the clock honest.</h2>
            <p>Local checkpoints measure time. They do not measure mastery.</p>
          </div>
          <span className="small-tag">TODAY · UTC {c.summary.todayDate}</span>
        </div>
        <div className="focus-policy-grid">
          <div>
            <strong>{durationLabel(c.summary.todaySeconds)}</strong>
            <p>Confirmed focus today, grouped by UTC date.</p>
          </div>
          <div>
            <ShieldCheck size={22} />
            <p>
              Long heartbeat gaps and clock discontinuities are excluded. After
              a restart, an interrupted session retains its last saved
              checkpoint.
            </p>
          </div>
          <div>
            <Clock3 size={22} />
            <p>
              Finish a session before closing the app. Live timer estimates are
              separate from the confirmed totals above.
            </p>
          </div>
        </div>
      </section>
      <section className="panel focus-history">
        <div className="section-heading compact">
          <div>
            <h2>Session history</h2>
            <p>Most recent sessions. Totals include all recorded history.</p>
          </div>
          <button
            className="text-button"
            disabled={!native || c.busy}
            onClick={c.refresh}
          >
            <RefreshCw size={12} />
            Refresh log
          </button>
        </div>
        {c.summary.sessions.filter((s) => s.status !== "active").length ? (
          <div className="focus-history-table">
            {c.summary.sessions
              .filter((s) => s.status !== "active")
              .map((s) => (
                <div key={s.id}>
                  <span>
                    <strong>{topicTitle(s.topicId)}</strong>
                    <small>{new Date(s.startedAt).toLocaleString()}</small>
                  </span>
                  <span className={`session-status ${s.status}`}>
                    {s.status === "interrupted"
                      ? "Interrupted · checkpoint retained"
                      : "Finished"}
                  </span>
                  <strong>{durationLabel(s.durationSeconds)}</strong>
                </div>
              ))}
          </div>
        ) : (
          <p className="empty-copy">
            No finished sessions yet. Your focus log starts here.
          </p>
        )}
      </section>
    </>
  );
}
