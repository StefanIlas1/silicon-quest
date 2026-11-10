import { createContext, useContext, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronRight,
  History,
  RefreshCw,
  Repeat2,
  ShieldCheck,
  Target,
} from "lucide-react";
import { modules, quizQuestions } from "../curriculum/data";
import { native } from "./backend";
export type ReviewStage = "learning" | "needs_review" | "mastered";
export type ScheduledReview = {
  topicId: string;
  stage: ReviewStage;
  successfulReviews: number;
  dueAt: string;
  intervalDays: number;
  lastAttemptAt: string;
  lastQualifiedAt: string | null;
  lapseCount: number;
  due: boolean;
};
export type ReviewEvent = {
  attemptId: string;
  topicId: string;
  passed: boolean;
  qualified: boolean;
  reason: "first_pass" | "scheduled_pass" | "early_practice" | "failed_check";
  createdAt: string;
  stageAfter: ReviewStage;
  successfulReviewsAfter: number;
  dueAtAfter: string;
};
export type ReviewSummary = {
  asOf: string;
  due: ScheduledReview[];
  upcoming: ScheduledReview[];
  masteredCount: number;
  totalScheduled: number;
  evidenceRequired: number;
  intervalDays: number[];
  policyVersion: number;
  events: ReviewEvent[];
};
export type ReviewControl = {
  summary: ReviewSummary | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  accept: (summary: ReviewSummary) => void;
};
export const ReviewContext = createContext<ReviewControl>({
  summary: null,
  loading: false,
  error: "",
  refresh: async () => {},
  accept: () => {},
});
export const useReview = () => useContext(ReviewContext);
const eligibleIds = [...new Set(quizQuestions.map((q) => q.moduleId))];
const title = (id: string) => modules.find((m) => m.id === id)?.title ?? id;
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
const stageLabel = (stage: ReviewStage) =>
  stage === "mastered"
    ? "Spaced recall demonstrated"
    : stage === "needs_review"
      ? "Rebuilding recall evidence"
      : "Building recall";
export function ReviewOverview({ onOpen }: { onOpen: () => void }) {
  const c = useReview();
  return (
    <section className="review-overview panel">
      <div>
        <span className="eyebrow">
          <Repeat2 size={14} />
          KEEP THE KNOWLEDGE
        </span>
        <h2>
          {c.summary
            ? c.summary.due.length
              ? `${c.summary.due.length} ${c.summary.due.length === 1 ? "idea is" : "ideas are"} ready to revisit.`
              : c.summary.totalScheduled
                ? "Let the spacing do its work."
                : "Start a recall habit."
            : "Your recall queue, grounded in evidence."}
        </h2>
        <p>
          {c.summary
            ? `${c.summary.upcoming.length} scheduled · ${c.summary.masteredCount} topics with repeated recall evidence`
            : "The desktop app builds a schedule from real knowledge checks."}
        </p>
      </div>
      <button className="secondary-button" onClick={onOpen}>
        Review queue
        <ArrowRight size={14} />
      </button>
    </section>
  );
}
export function ReviewTopicState({ topicId }: { topicId: string }) {
  const c = useReview();
  const item = [...(c.summary?.due ?? []), ...(c.summary?.upcoming ?? [])].find(
    (r) => r.topicId === topicId,
  );
  if (!eligibleIds.includes(topicId)) return null;
  return (
    <div className="topic-review-state">
      <div className="card-topline">
        <span className="eyebrow">
          <Repeat2 size={12} />
          SPACED RECALL
        </span>
        {item && (
          <span className={`review-status ${item.due ? "due" : ""}`}>
            {item.due ? "Review due" : "Scheduled"}
          </span>
        )}
      </div>
      {!c.summary ? (
        <p>
          {native
            ? "Review schedule is unavailable. Your graded attempt still determines the latest check result."
            : "Review schedules are available in the desktop app."}
        </p>
      ) : item ? (
        <>
          <h3>{stageLabel(item.stage)}</h3>
          <EvidenceDots
            successful={item.successfulReviews}
            required={c.summary.evidenceRequired}
          />
          <p>
            {Math.min(item.successfulReviews, c.summary.evidenceRequired)} of{" "}
            {c.summary.evidenceRequired} qualifying passes in the current
            streak.
            <br />
            Next review: {date(item.dueAt)}.
          </p>
        </>
      ) : (
        <p>
          No graded check recorded yet. The first attempt starts a real review
          schedule.
        </p>
      )}
      <small>
        A quick repeat is practice. Only a pass when due advances spaced recall.
      </small>
    </div>
  );
}
export function ReviewFeedback({ event }: { event: ReviewEvent }) {
  const message =
    event.reason === "early_practice"
      ? "Practice recorded. This early pass keeps the existing review date and does not add spaced evidence."
      : event.reason === "failed_check"
        ? "Gap found. The current evidence streak resets; earlier XP and attempt history are retained."
        : event.stageAfter === "mastered"
          ? "Repeated recall demonstrated through qualifying checks. Continue reviewing when due."
          : event.reason === "first_pass"
            ? "First recall evidence recorded. Return when the scheduled review is due."
            : "Scheduled recall evidence recorded. The next interval is now scheduled.";
  return (
    <div
      className={`review-feedback ${event.passed ? "" : "needs-review"}`}
      role="status"
    >
      <div>
        <Repeat2 size={15} />
        <strong>
          {event.qualified
            ? "Qualifying recall evidence"
            : event.reason === "early_practice"
              ? "Early practice"
              : "Review recommended"}
        </strong>
      </div>
      <p>{message}</p>
      <small>
        Next review: {date(event.dueAtAfter)}. Dates are shown in your local
        time.
      </small>
    </div>
  );
}
function EvidenceDots({
  successful,
  required,
}: {
  successful: number;
  required: number;
}) {
  return (
    <div
      className="evidence-dots"
      aria-label={`${Math.min(successful, required)} of ${required} qualifying recall passes`}
    >
      {Array.from({ length: required }, (_, i) => (
        <span key={i} className={successful > i ? "earned" : ""}>
          {successful > i ? <Check size={10} /> : i + 1}
        </span>
      ))}
    </div>
  );
}
export function ReviewPage({
  onQuiz,
  onStudy,
  busy = false,
}: {
  onQuiz: (topicId: string) => void;
  onStudy: (topicId: string) => void;
  busy?: boolean;
}) {
  const c = useReview();
  const [tab, setTab] = useState<"due" | "upcoming" | "new">("due");
  const scheduled = new Set(
    [...(c.summary?.due ?? []), ...(c.summary?.upcoming ?? [])].map(
      (r) => r.topicId,
    ),
  );
  const untested = c.summary
    ? eligibleIds.filter((id) => !scheduled.has(id))
    : [];
  const list = c.summary
    ? tab === "due"
      ? c.summary.due
      : tab === "upcoming"
        ? c.summary.upcoming
        : []
    : [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="tiny-line" />
            RECALL, THEN RETURN
          </div>
          <h1>Make understanding last.</h1>
          <p>
            A real review schedule, built from graded retrieval rather than time
            spent or pages read.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={!native || c.loading}
          onClick={c.refresh}
        >
          <RefreshCw size={13} />
          {c.loading ? "Refreshing…" : "Refresh queue"}
        </button>
      </div>
      <div className="review-stats">
        <section className="panel">
          <CalendarClock size={20} />
          <strong>{c.summary?.due.length ?? "—"}</strong>
          <span>DUE TO REVISIT</span>
        </section>
        <section className="panel">
          <Target size={20} />
          <strong>
            {c.summary?.masteredCount ?? "—"}
            <small>/ {eligibleIds.length}</small>
          </strong>
          <span>REPEATED RECALL DEMONSTRATED</span>
        </section>
        <section className="panel">
          <History size={20} />
          <strong>{c.summary?.totalScheduled ?? "—"}</strong>
          <span>TOPICS WITH A REAL SCHEDULE</span>
        </section>
      </div>
      {c.error && (
        <div className="review-error" role="alert">
          <p>{c.error}</p>
          <small>
            {c.summary
              ? "Showing the last confirmed queue. Refresh before relying on its due count."
              : "No review progress has been assumed."}
          </small>
        </div>
      )}
      {!c.summary ? (
        <section className="panel review-empty">
          <div className="empty-icon">
            <Repeat2 size={29} />
          </div>
          <h2>
            {c.loading
              ? "Opening your local review queue…"
              : native
                ? "Review storage is unavailable."
                : "Recall lives in the desktop app."}
          </h2>
          <p>
            {native
              ? "Your schedule loads from real graded attempts in the local database."
              : "This browser preview creates no review dates, grades, or mastery."}
          </p>
          {native && !c.loading && (
            <button className="secondary-button" onClick={c.refresh}>
              <RefreshCw size={13} />
              Retry loading queue
            </button>
          )}
        </section>
      ) : (
        <>
          <div className="tabs review-tabs">
            {(
              [
                { id: "due", label: "Due now", count: c.summary.due.length },
                {
                  id: "upcoming",
                  label: "Upcoming",
                  count: c.summary.upcoming.length,
                },
                { id: "new", label: "Not yet checked", count: untested.length },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "selected" : ""}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                <span>{t.count}</span>
              </button>
            ))}
          </div>
          <div className="review-list">
            {tab === "new" ? (
              untested.length ? (
                untested.map((id) => (
                  <section className="panel review-item" key={id}>
                    <div className="review-item-main">
                      <span className="eyebrow">
                        NO GRADED ATTEMPT RECORDED
                      </span>
                      <h2>{title(id)}</h2>
                      <p>
                        A first check establishes where to begin. Reading status
                        and focus time do not stand in for retrieval.
                      </p>
                    </div>
                    <div className="review-item-actions">
                      <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() => onQuiz(id)}
                      >
                        Take first check
                        <ArrowRight size={14} />
                      </button>
                      <button
                        className="text-button"
                        onClick={() => onStudy(id)}
                      >
                        Open study guide
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </section>
                ))
              ) : (
                <div className="panel review-empty">
                  <Check size={24} />
                  <h2>Every available check has a starting point.</h2>
                  <p>Keep following your due and upcoming reviews.</p>
                </div>
              )
            ) : list.length ? (
              list.map((item) => (
                <section
                  className={`panel review-item ${item.due ? "is-due" : ""}`}
                  key={item.topicId}
                >
                  <div className="review-item-main">
                    <div className="card-topline">
                      <span
                        className={`review-status ${item.due ? "due" : ""}`}
                      >
                        <CalendarClock size={11} />
                        {item.due ? "Review due" : "Scheduled review"}
                      </span>
                      <span className="review-stage">
                        {stageLabel(item.stage)}
                      </span>
                    </div>
                    <h2>{title(item.topicId)}</h2>
                    <div className="review-evidence">
                      <EvidenceDots
                        successful={item.successfulReviews}
                        required={c.summary!.evidenceRequired}
                      />
                      <span>
                        {Math.min(
                          item.successfulReviews,
                          c.summary!.evidenceRequired,
                        )}{" "}
                        / {c.summary!.evidenceRequired} qualifying passes
                      </span>
                    </div>
                    <p>
                      <strong>{item.due ? "Due" : "Next review"}:</strong>{" "}
                      {date(item.dueAt)}
                      <br />
                      <strong>Last check:</strong> {date(item.lastAttemptAt)}
                      {item.lapseCount > 0 && (
                        <>
                          {" "}
                          · {item.lapseCount}{" "}
                          {item.lapseCount === 1 ? "lapse" : "lapses"} recorded
                        </>
                      )}
                    </p>
                  </div>
                  <div className="review-item-actions">
                    <button
                      className={
                        item.due ? "primary-button" : "secondary-button"
                      }
                      disabled={busy}
                      onClick={() => onQuiz(item.topicId)}
                    >
                      {item.due ? "Review now" : "Practice early"}
                      <ArrowRight size={14} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => onStudy(item.topicId)}
                    >
                      Open study guide
                      <ChevronRight size={13} />
                    </button>
                    {!item.due && (
                      <small>Early passes keep the current due date.</small>
                    )}
                  </div>
                </section>
              ))
            ) : (
              <section className="panel review-empty">
                <div className="empty-icon">
                  <ShieldCheck size={27} />
                </div>
                <h2>
                  {tab === "due"
                    ? "Nothing is due right now."
                    : "No upcoming reviews yet."}
                </h2>
                <p>
                  {c.summary.totalScheduled
                    ? "A due date is a prompt to retrieve, not proof you forgot. You can study or practice early without advancing the schedule."
                    : "Take a first knowledge check to create a schedule. No reading or timer activity is treated as a passed check."}
                </p>
                <button
                  className="secondary-button"
                  onClick={() =>
                    setTab(
                      untested.length
                        ? "new"
                        : c.summary!.due.length
                          ? "due"
                          : "upcoming",
                    )
                  }
                >
                  {untested.length
                    ? "Explore available checks"
                    : c.summary.due.length
                      ? "View due reviews"
                      : "View upcoming reviews"}
                  <ArrowRight size={13} />
                </button>
              </section>
            )}
          </div>
          <section className="review-policy panel">
            <span className="eyebrow">
              <ShieldCheck size={14} />A SMALL, TRANSPARENT POLICY
            </span>
            <h2>
              {c.summary.evidenceRequired} qualifying passes, separated in time.
            </h2>
            <p>
              The first graded check creates a schedule. A pass counts on that
              first check or when a scheduled review is due. Early repeats
              remain practice; a failed check resets the streak and schedules
              another retrieval.
            </p>
            <div className="review-intervals">
              {c.summary.intervalDays.map((n, i) => (
                <span key={n}>
                  {i > 0 && <ArrowRight size={11} />}
                  <strong>
                    {n} {n === 1 ? "day" : "days"}
                  </strong>
                </span>
              ))}
            </div>
            <p className="micro-copy">
              Intervals are exact 24-hour days. Dates above use your local time.
              Due dates alone do not erase prior evidence. Repeated recall here
              concerns a small set of curated questions; project correctness and
              performance still require separate proof. Repeated quiz passes
              award no additional XP.
            </p>
          </section>
          <section className="panel review-history">
            <div className="section-heading compact">
              <div>
                <h2>Retrieval history</h2>
                <p>
                  The latest 100 recorded review events, including early
                  practice and failures.
                </p>
              </div>
              <span className="small-tag">GRADED EVIDENCE</span>
            </div>
            {c.summary.events.length ? (
              <div className="review-history-list">
                {c.summary.events.map((e) => (
                  <div key={e.attemptId}>
                    <span
                      className={`review-event-icon ${e.passed ? "passed" : "failed"}`}
                    >
                      {e.passed ? <Check size={14} /> : <Repeat2 size={14} />}
                    </span>
                    <span>
                      <strong>{title(e.topicId)}</strong>
                      <small>
                        {date(e.createdAt)} ·{" "}
                        {e.reason === "first_pass"
                          ? "First pass"
                          : e.reason === "scheduled_pass"
                            ? "Scheduled pass"
                            : e.reason === "early_practice"
                              ? "Early practice"
                              : "Failed check"}
                      </small>
                    </span>
                    <span className="review-event-result">
                      {stageLabel(e.stageAfter)}
                      <small>Next: {date(e.dueAtAfter)}</small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-copy">No graded retrieval events yet.</p>
            )}
            <p className="micro-copy">
              Queue confirmed as of {date(c.summary.asOf)}. Refreshes while the
              app is open.
            </p>
          </section>
        </>
      )}
    </>
  );
}
