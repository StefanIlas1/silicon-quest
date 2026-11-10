import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ReviewProvider from "./ReviewProvider";
import { ReviewFeedback, ReviewPage, useReview } from "./Review";
import type { ReviewEvent, ReviewSummary, ScheduledReview } from "./Review";
import App from "./App";
import { emptyDashboard } from "./backend";
const mock = vi.hoisted(() => ({ native: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mock.invoke,
  isTauri: () => true,
}));
vi.mock("./backend", async (original) => ({
  ...(await original<typeof import("./backend")>()),
  get native() {
    return mock.native;
  },
}));
const due: ScheduledReview = {
  topicId: "cache-locality",
  stage: "learning",
  successfulReviews: 2,
  dueAt: "2026-11-10T05:00:00Z",
  intervalDays: 3,
  lastAttemptAt: "2026-11-07T05:00:00Z",
  lastQualifiedAt: "2026-11-07T05:00:00Z",
  lapseCount: 0,
  due: true,
};
const upcoming: ScheduledReview = {
  ...due,
  topicId: "cpp-lifetime",
  successfulReviews: 1,
  intervalDays: 1,
  dueAt: "2026-11-11T05:00:00Z",
  due: false,
};
const firstEvent: ReviewEvent = {
  attemptId: "review-attempt-1",
  topicId: "cache-locality",
  passed: true,
  qualified: true,
  reason: "first_pass",
  createdAt: "2026-11-10T05:00:00Z",
  stageAfter: "learning",
  successfulReviewsAfter: 1,
  dueAtAfter: "2026-11-11T05:00:00Z",
};
let summary: ReviewSummary;
beforeEach(() => {
  mock.native = true;
  vi.clearAllMocks();
  summary = {
    asOf: "2026-11-10T05:00:00Z",
    due: [{ ...due }],
    upcoming: [{ ...upcoming }],
    masteredCount: 0,
    totalScheduled: 2,
    evidenceRequired: 3,
    intervalDays: [1, 3, 7, 14, 30],
    policyVersion: 1,
    events: [],
  };
  mock.invoke.mockImplementation(async (name) => {
    if (name === "get_review_summary") return structuredClone(summary);
    if (name === "get_dashboard") return { ...emptyDashboard };
  });
});
afterEach(cleanup);
describe("scheduled review queue", () => {
  it("locks submitted answers and reuses the same attempt after a lost grading response", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    let lost = true;
    mock.invoke.mockImplementation(async (name, args) => {
      if (name === "get_quiz")
        return {
          topicId: args.topicId,
          questions: [
            {
              id: "retry-review-q",
              prompt: "Retry this recall",
              options: ["Option A", "Option B"],
            },
          ],
        };
      if (name === "submit_quiz") {
        if (lost) {
          lost = false;
          throw { message: "Grading response lost" };
        }
        return {
          attempt: {
            attemptId: args.attemptId,
            topicId: args.topicId,
            score: 1,
            total: 1,
            passed: true,
            xpAwarded: 0,
            createdAt: firstEvent.createdAt,
          },
          feedback: [
            {
              questionId: "retry-review-q",
              correct: true,
              correctIndex: 1,
              explanation: "Same confirmed result.",
            },
          ],
          dashboard: { ...emptyDashboard },
          reviewUpdate: firstEvent,
          reviewSummary: summary,
        };
      }
      return implementation(name, args);
    });
    render(
      <ReviewProvider>
        <App />
      </ReviewProvider>,
    );
    await screen.findByText("Local database connected");
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).getByRole("button", { name: /Review queue/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Review now" }));
    await screen.findByText("Retry this recall");
    fireEvent.click(screen.getByLabelText("Option B"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    await screen.findByText("Grading response lost");
    expect(
      (screen.getByLabelText("Option A") as HTMLInputElement).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry submitted answers" }),
    );
    await screen.findByText("1/1 · Passed");
    const attempts = mock.invoke.mock.calls
      .filter(([name]) => name === "submit_quiz")
      .map(([, args]) => args);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(screen.queryByText("Grading response lost")).toBeNull();
  });
  it("starts only real available checks and distinguishes due, upcoming and untested topics", async () => {
    const onQuiz = vi.fn(),
      onStudy = vi.fn();
    render(
      <ReviewProvider>
        <ReviewPage onQuiz={onQuiz} onStudy={onStudy} />
      </ReviewProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Review now" }));
    expect(onQuiz).toHaveBeenCalledWith("cache-locality");
    fireEvent.click(screen.getByRole("button", { name: "Open study guide" }));
    expect(onStudy).toHaveBeenCalledWith("cache-locality");
    fireEvent.click(screen.getByRole("button", { name: /Upcoming/ }));
    expect(
      screen.getByText("Early passes keep the current due date."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Practice early" }));
    expect(onQuiz).toHaveBeenLastCalledWith("cpp-lifetime");
    fireEvent.click(screen.getByRole("button", { name: /Not yet checked/ }));
    expect(
      screen.getAllByRole("button", { name: "Take first check" }),
    ).toHaveLength(6);
  });
  it("makes no review storage calls or invented schedule in browser preview", () => {
    mock.native = false;
    render(
      <ReviewProvider>
        <ReviewPage onQuiz={vi.fn()} onStudy={vi.fn()} />
      </ReviewProvider>,
    );
    expect(screen.getByText("Recall lives in the desktop app.")).toBeTruthy();
    expect(
      screen.getByText(
        "This browser preview creates no review dates, grades, or mastery.",
      ),
    ).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "Refresh queue",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("ignores an old queue response after a graded quiz supplies a newer snapshot", async () => {
    let resolve: (value: ReviewSummary) => void = () => {};
    mock.invoke.mockReturnValue(
      new Promise<ReviewSummary>((done) => {
        resolve = done;
      }),
    );
    function Harness() {
      const c = useReview();
      return (
        <>
          <output aria-label="Repeated recall count">
            {c.summary?.masteredCount ?? "unknown"}
          </output>
          <button onClick={() => c.accept({ ...summary, masteredCount: 2 })}>
            Accept graded result
          </button>
        </>
      );
    }
    render(
      <ReviewProvider>
        <Harness />
      </ReviewProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Accept graded result" }),
    );
    expect(screen.getByLabelText("Repeated recall count").textContent).toBe(
      "2",
    );
    await act(async () => {
      resolve({ ...summary, masteredCount: 0 });
    });
    expect(screen.getByLabelText("Repeated recall count").textContent).toBe(
      "2",
    );
  });
  it("connects the real quiz flow to scheduling without calling a single pass mastered", async () => {
    summary = { ...summary, due: [], upcoming: [], totalScheduled: 0 };
    const implementation = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation(async (name, args) => {
      if (name === "get_quiz")
        return {
          topicId: args.topicId,
          questions: [
            {
              id: "review-q1",
              prompt: "Recall the concept",
              options: ["Choose A", "Choose B"],
            },
          ],
        };
      if (name === "submit_quiz") {
        summary = {
          ...summary,
          upcoming: [
            {
              ...due,
              successfulReviews: 1,
              due: false,
              intervalDays: 1,
              dueAt: firstEvent.dueAtAfter,
            },
          ],
          totalScheduled: 1,
          events: [firstEvent],
        };
        return {
          attempt: {
            attemptId: "review-attempt-1",
            topicId: "cache-locality",
            score: 1,
            total: 1,
            passed: true,
            xpAwarded: 100,
            createdAt: firstEvent.createdAt,
          },
          feedback: [
            {
              questionId: "review-q1",
              correct: true,
              correctIndex: 1,
              explanation: "Evidence supports this answer.",
            },
          ],
          dashboard: {
            ...emptyDashboard,
            totalXp: 100,
            topics: [
              {
                topicId: "cache-locality",
                status: "reading",
                mastery: "passed",
                bestScore: 100,
                lastStudiedAt: firstEvent.createdAt,
              },
            ],
          },
          reviewUpdate: firstEvent,
          reviewSummary: summary,
        };
      }
      return implementation(name, args);
    });
    render(
      <ReviewProvider>
        <App />
      </ReviewProvider>,
    );
    await screen.findByText("Local database connected");
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).getByRole("button", { name: /Review queue/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Not yet checked/ }),
    );
    const card = screen
      .getByRole("heading", { name: "Caches & locality" })
      .closest("section")!;
    fireEvent.click(
      within(card).getByRole("button", { name: "Take first check" }),
    );
    await screen.findByText("Recall the concept");
    fireEvent.click(screen.getByLabelText("Choose B"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    await screen.findByText(
      "First recall evidence recorded. Return when the scheduled review is due.",
    );
    expect(mock.invoke).toHaveBeenCalledWith("submit_quiz", {
      topicId: "cache-locality",
      answers: [1],
      attemptId: expect.any(String),
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to learning" }));
    fireEvent.click(screen.getByRole("button", { name: /Upcoming/ }));
    expect(screen.getByText("1 / 3 qualifying passes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    const stat = screen.getByText("SPACED RECALL").closest("section")!;
    expect(within(stat).getByText("0")).toBeTruthy();
  });
  it("explains early practice without claiming another qualifying pass", () => {
    render(
      <ReviewFeedback
        event={{ ...firstEvent, qualified: false, reason: "early_practice" }}
      />,
    );
    expect(screen.getByText("Early practice")).toBeTruthy();
    expect(screen.getByText(/does not add spaced evidence/)).toBeTruthy();
    expect(screen.queryByText("Qualifying recall evidence")).toBeNull();
  });
  it("keeps rebuilding recall distinct from the latest check result", async () => {
    summary = {
      ...summary,
      due: [{ ...due, stage: "needs_review", successfulReviews: 0 }],
      upcoming: [],
    };
    render(
      <ReviewProvider>
        <ReviewPage onQuiz={vi.fn()} onStudy={vi.fn()} />
      </ReviewProvider>,
    );
    await screen.findByText("Rebuilding recall evidence");
    expect(screen.queryByText("Latest check needs review")).toBeNull();
    expect(screen.getByText("0 / 3 qualifying passes")).toBeTruthy();
  });
  it("shows a stale-data warning when refresh fails rather than replacing confirmed records", async () => {
    render(
      <ReviewProvider>
        <ReviewPage onQuiz={vi.fn()} onStudy={vi.fn()} />
      </ReviewProvider>,
    );
    await screen.findByRole("button", { name: "Review now" });
    mock.invoke.mockRejectedValue({ message: "Review database unavailable" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh queue" }));
    await screen.findByText("Review database unavailable");
    expect(
      screen.getByText(
        "Showing the last confirmed queue. Refresh before relying on its due count.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review now" })).toBeTruthy();
  });
});
