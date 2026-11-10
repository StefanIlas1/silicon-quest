import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { emptyDashboard } from "./backend";
import App from "./App";
import type { ChapterDraft } from "./ChapterIndex";
import { FocusContext, emptyFocusSummary } from "./Focus";
import { modules, phases } from "../curriculum/data";
const mock = vi.hoisted(() => ({
  native: true,
  dashboard: vi.fn(),
  status: vi.fn(),
  note: vi.fn(),
  quiz: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("./backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./backend")>()),
  get native() {
    return mock.native;
  },
  api: mock,
}));
vi.mock("./Reader", () => ({
  default: ({
    chapterDraft,
    onChapterDraftChange,
  }: {
    chapterDraft?: ChapterDraft | null;
    onChapterDraftChange?: (draft: ChapterDraft | null) => void;
  }) => (
    <div>
      Local PDF workspace
      <input
        aria-label="Mock chapter draft"
        value={chapterDraft?.note ?? ""}
        onChange={(e) =>
          onChapterDraftChange?.({
            dirty: true,
            id: "pending-chapter",
            title: "My edition title",
            position: "1",
            status: "reading",
            note: e.target.value,
            pageStart: "",
            pageEnd: "",
            documentRevision: null,
            expectedVersion: 0,
          })
        }
      />
    </div>
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  mock.native = true;
  vi.clearAllMocks();
  mock.dashboard.mockResolvedValue({ ...emptyDashboard });
});
describe("learning workspace", () => {
  it("preserves chapter drafts through navigation and warns in backup settings", async () => {
    render(<App />);
    await screen.findByText("Local database connected");
    fireEvent.click(screen.getByRole("button", { name: /Start learning/ }));
    const input = await screen.findByLabelText("Mock chapter draft");
    fireEvent.change(input, {
      target: { value: "Private unsaved chapter notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: /Systems explorer/ }));
    expect(screen.getByText(/1 book has unsaved chapter drafts/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: /Start learning/ }));
    expect(
      ((await screen.findByLabelText("Mock chapter draft")) as HTMLInputElement)
        .value,
    ).toBe("Private unsaved chapter notes");
  });

  it("refreshes activity after a confirmed focus checkpoint shorter than a second", async () => {
    const dashboard = { ...emptyDashboard, localToday: "2026-11-10" };
    mock.dashboard.mockResolvedValue(dashboard);
    const control = {
      summary: emptyFocusSummary,
      available: true,
      readOnly: false,
      loading: false,
      busy: false,
      error: "",
      acknowledgedAt: 0,
      begin: async () => {},
      finish: async () => {},
      refresh: async () => {},
    };
    const view = render(
      <FocusContext.Provider value={control}>
        <App />
      </FocusContext.Provider>,
    );
    await screen.findByText("Local database connected");
    await waitFor(() => expect(mock.dashboard).toHaveBeenCalledTimes(2));
    mock.dashboard.mockResolvedValue({
      ...dashboard,
      activityDays: ["2026-11-10"],
      streakDays: 1,
      longestStreakDays: 1,
    });
    view.rerender(
      <FocusContext.Provider value={{ ...control, acknowledgedAt: 500 }}>
        <App />
      </FocusContext.Provider>,
    );
    await screen.findByText("Today's activity is saved.");
    expect(mock.dashboard).toHaveBeenCalledTimes(3);
    expect(control.summary.totalSeconds).toBe(0);
  });
  it("clears stale activity history after an authoritative reading update", async () => {
    mock.dashboard
      .mockResolvedValueOnce({ ...emptyDashboard, localToday: "2026-11-10" })
      .mockRejectedValue(new Error("Storage temporarily unavailable"));
    mock.status.mockResolvedValue({
      ...emptyDashboard,
      localToday: "2026-11-10",
      activityDays: ["2026-11-10"],
    });
    render(<App />);
    await screen.findByText(/Showing the last confirmed history/);
    fireEvent.click(screen.getByRole("button", { name: /Start learning/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reading" }));
    await waitFor(() => expect(mock.status).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    await screen.findByText("Today's activity is saved.");
    expect(screen.queryByText(/Showing the last confirmed history/)).toBeNull();
  });
  it("uses the recommended topic's actual phase in dashboard and sidebar labels", async () => {
    mock.dashboard.mockResolvedValue({
      ...emptyDashboard,
      topics: modules
        .filter((m) => m.phaseId === "phase-1")
        .map((m) => ({
          topicId: m.id,
          status: "read",
          mastery: "untested",
          bestScore: null,
          lastStudiedAt: null,
        })),
    });
    render(<App />);
    await screen.findByText("Local database connected");
    expect(document.querySelector(".chapter-pill")?.textContent).toContain(
      "PHASE 02",
    );
    expect(document.querySelector(".current-phase")?.textContent).toContain(
      phases.find((p) => p.id === "phase-2")!.title,
    );
    expect(
      document.querySelector(".continue-card .meta-row")?.textContent,
    ).toContain("PHASE 02");
  });
  it("offers recall after all reading is marked read without claiming the roadmap complete", async () => {
    mock.dashboard.mockResolvedValue({
      ...emptyDashboard,
      topics: modules.map((m) => ({
        topicId: m.id,
        status: "read",
        mastery: "untested",
        bestScore: null,
        lastStudiedAt: null,
      })),
    });
    render(<App />);
    await screen.findByText("Your reading log is complete.");
    expect(
      screen.getByText(/reading alone does not complete the roadmap/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open review queue" }));
    expect(
      screen.getByRole("heading", { name: "Make understanding last." }),
    ).toBeTruthy();
  });
  it("preserves separate unsaved drafts while moving between topics and pages", async () => {
    render(<App />);
    await screen.findByText("Local database connected");
    fireEvent.click(screen.getByRole("button", { name: /Start learning/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Topic notes" }), {
      target: { value: "My cache hypothesis" },
    });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "data-layout" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Topic notes" }), {
      target: { value: "My layout hypothesis" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Learning path/ }));
    fireEvent.click(screen.getByRole("button", { name: /Caches & locality/ }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Topic notes",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("My cache hypothesis");
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "data-layout" },
    });
    expect(
      (
        screen.getByRole("textbox", {
          name: "Topic notes",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("My layout hypothesis");
    expect(mock.note).not.toHaveBeenCalled();
  });
  it("keeps browser progress unavailable and visibly explains the boundary", async () => {
    mock.native = false;
    render(<App />);
    expect(screen.getByText(/Browser preview. Durable progress/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Start learning/ }));
    expect(
      (screen.getByRole("button", { name: "Save note" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: /Take knowledge check/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(mock.dashboard).not.toHaveBeenCalled();
  });
  it("records quiz results from the backend and advances XP display", async () => {
    mock.quiz.mockResolvedValue({
      topicId: "cache-locality",
      questions: [
        {
          id: "q1",
          prompt: "Test reasoning",
          options: ["Answer A", "Answer B"],
        },
      ],
    });
    const attempt = {
      attemptId: "test-attempt",
      topicId: "cache-locality",
      score: 1,
      total: 1,
      passed: true,
      xpAwarded: 100,
      createdAt: "2026-11-10T05:00:00Z",
    };
    mock.submit.mockResolvedValue({
      attempt,
      feedback: [
        {
          questionId: "q1",
          correct: true,
          correctIndex: 1,
          explanation: "A measured explanation.",
        },
      ],
      dashboard: {
        ...emptyDashboard,
        totalXp: 100,
        attempts: [attempt],
        topics: [
          {
            topicId: "cache-locality",
            status: "reading",
            mastery: "passed",
            bestScore: 100,
            lastStudiedAt: "2026-11-10",
          },
        ],
      },
    });
    render(<App />);
    await screen.findByText("Local database connected");
    fireEvent.click(screen.getByRole("button", { name: /Start learning/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /Take knowledge check/ }),
    );
    await screen.findByText("Test reasoning");
    expect(
      (
        screen.getByRole("button", {
          name: /Submit answers/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("Answer B"));
    fireEvent.click(screen.getByRole("button", { name: /Submit answers/ }));
    await screen.findByText("1/1 · Passed");
    expect(mock.submit).toHaveBeenCalledWith(
      "cache-locality",
      [1],
      expect.any(String),
    );
    expect(screen.getByText(/100 XP earned/)).toBeTruthy();
  });
  it("keeps an unsaved note when reading status changes", async () => {
    mock.status.mockResolvedValue({
      ...emptyDashboard,
      topics: [
        {
          topicId: "cache-locality",
          status: "reading",
          mastery: "untested",
          bestScore: null,
          lastStudiedAt: "2026-11-10",
        },
      ],
    });
    mock.note.mockResolvedValue({
      ...emptyDashboard,
      notes: [
        {
          topicId: "cache-locality",
          body: "Test the working set.",
          updatedAt: "2026-11-10",
        },
      ],
    });
    render(<App />);
    await screen.findByText("Local database connected");
    fireEvent.click(screen.getByRole("button", { name: /Start learning/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Topic notes" }), {
      target: { value: "Test the working set." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reading" }));
    await waitFor(() => expect(mock.status).toHaveBeenCalled());
    expect(
      (
        screen.getByRole("textbox", {
          name: "Topic notes",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Test the working set.");
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(mock.note).toHaveBeenCalledWith(
        "cache-locality",
        "Test the working set.",
      ),
    );
  });
  it("disables unavailable knowledge checks and gives a roadmap-only topic its own workspace", async () => {
    render(<App />);
    await screen.findByText("Local database connected");
    fireEvent.click(screen.getByRole("button", { name: /Learning path/ }));
    fireEvent.click(screen.getByRole("button", { name: /AoS vs SoA/ }));
    expect(
      (
        screen.getByRole("button", {
          name: /Knowledge check coming later/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Learning path/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /Serving, streams & batching/ }),
    );
    expect(screen.getByText("ROADMAP STUDY WORKSPACE")).toBeTruthy();
    expect(screen.queryByText("Local PDF workspace")).toBeNull();
  });
});
