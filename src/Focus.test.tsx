import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import FocusProvider from "./FocusProvider";
import type { FocusSession, FocusSummary as Summary } from "./FocusProvider";
import { FocusPage } from "./Focus";
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
const session: FocusSession = {
  id: "focus-1",
  topicId: "cache-locality",
  status: "active",
  startedAt: "2026-11-10T05:00:00Z",
  endedAt: null,
  updatedAt: "2026-11-10T05:00:00Z",
  elapsedSeconds: 0,
  sequence: 0,
  excludedGapCount: 0,
};
let state: Summary;
beforeEach(() => {
  vi.clearAllMocks();
  mock.native = true;
  state = {
    activeSession: null,
    sessions: [],
    totalSeconds: 0,
    completedSessions: 0,
    interruptedSessions: 0,
    todaySeconds: 0,
    todayDate: "2026-11-10",
    topicSeconds: [],
    canControl: true,
  };
  mock.invoke.mockImplementation(async (name, args) => {
    if (name === "start_focus_session") {
      if (!state.activeSession) {
        state = {
          ...state,
          activeSession: { ...session },
          sessions: [{ ...session }],
        };
      }
      return structuredClone(state);
    }
    if (name === "tick_focus_session" && state.activeSession) {
      const next = {
        ...state.activeSession,
        sequence: args.sequence,
        elapsedSeconds: state.activeSession.elapsedSeconds + 10,
      };
      state = {
        ...state,
        activeSession: next,
        sessions: [next],
        totalSeconds: next.elapsedSeconds,
        todaySeconds: next.elapsedSeconds,
        topicSeconds: [{ topicId: next.topicId, seconds: next.elapsedSeconds }],
      };
    }
    if (name === "end_focus_session" && state.activeSession) {
      const done = {
        ...state.activeSession,
        status: "completed" as const,
        sequence: args.sequence,
        elapsedSeconds: state.activeSession.elapsedSeconds + 5,
        endedAt: "2026-11-10T05:00:15Z",
      };
      state = {
        ...state,
        activeSession: null,
        sessions: [done],
        completedSessions: 1,
        totalSeconds: done.elapsedSeconds,
        todaySeconds: done.elapsedSeconds,
        topicSeconds: [{ topicId: done.topicId, seconds: done.elapsedSeconds }],
      };
    }
    return structuredClone(state);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const app = () => (
  <FocusProvider>
    <FocusPage />
  </FocusProvider>
);
describe("confirmed focus sessions", () => {
  it("refreshes a rejected sequence before sending the next checkpoint", async () => {
    vi.useFakeTimers();
    state.activeSession = { ...session };
    state.sessions = [{ ...session }];
    const implementation = mock.invoke.getMockImplementation()!;
    let reject = true;
    mock.invoke.mockImplementation(async (name, args) => {
      if (name === "tick_focus_session" && reject) {
        reject = false;
        state = {
          ...state,
          activeSession: { ...session, elapsedSeconds: 40, sequence: 4 },
          totalSeconds: 40,
          todaySeconds: 40,
        };
        throw {
          code: "invalid_sequence",
          message: "Refresh before the next checkpoint",
        };
      }
      return implementation(name, args);
    });
    await act(async () => {
      render(app());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Refresh before the next checkpoint",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    const sequences = mock.invoke.mock.calls
      .filter(([name]) => name === "tick_focus_session")
      .map(([, args]) => args.sequence);
    expect(sequences).toEqual([1, 5]);
    expect(state.totalSeconds).toBe(50);
  });
  it("records no time or storage calls in the browser preview", async () => {
    mock.native = false;
    render(app());
    expect(
      (
        screen.getByRole("button", {
          name: "Start focus session",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Focus tracking requires the desktop app. This preview records no time.",
      ),
    ).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("starts and finishes through backend commands and uses authoritative duration", async () => {
    render(app());
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Start focus session",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start focus session" }),
    );
    await screen.findByRole("button", { name: "Finish session" });
    expect(mock.invoke).toHaveBeenCalledWith("start_focus_session", {
      topicId: "cache-locality",
      requestId: expect.any(String),
    });
    fireEvent.click(screen.getByRole("button", { name: "Finish session" }));
    await screen.findByText("Finished");
    expect(mock.invoke).toHaveBeenCalledWith("end_focus_session", {
      sessionId: "focus-1",
      sequence: 1,
    });
    expect(state.totalSeconds).toBe(5);
    expect(
      mock.invoke.mock.calls.every(([name]) => name.includes("focus")),
    ).toBe(true);
  });
  it("retries the same heartbeat sequence after a lost response and reconciles confirmed time", async () => {
    vi.useFakeTimers();
    state.activeSession = { ...session };
    state.sessions = [{ ...session }];
    const implementation = mock.invoke.getMockImplementation()!;
    let lost = true;
    mock.invoke.mockImplementation(async (name, args) => {
      if (name === "tick_focus_session" && args.sequence === 1) {
        if (lost) {
          lost = false;
          state = {
            ...state,
            activeSession: { ...session, elapsedSeconds: 10, sequence: 1 },
            totalSeconds: 10,
            todaySeconds: 10,
          };
          throw { message: "Lost checkpoint response" };
        }
        return structuredClone(state);
      }
      return implementation(name, args);
    });
    await act(async () => {
      render(app());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Only confirmed time",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    const sequences = mock.invoke.mock.calls
      .filter(([name]) => name === "tick_focus_session")
      .map(([, args]) => args.sequence);
    expect(sequences).toEqual([1, 1, 2]);
    expect(state.totalSeconds).toBe(20);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("keeps interrupted checkpoint history separate from active tracking", async () => {
    state = {
      ...state,
      totalSeconds: 40,
      todaySeconds: 40,
      interruptedSessions: 1,
      sessions: [
        {
          ...session,
          status: "interrupted",
          elapsedSeconds: 40,
          sequence: 4,
          endedAt: "2026-11-10T05:00:40Z",
        },
      ],
    };
    render(app());
    await screen.findByText("Interrupted · checkpoint retained");
    expect(screen.queryByRole("button", { name: "Finish session" })).toBeNull();
    expect(
      mock.invoke.mock.calls.some(([name]) => name === "start_focus_session"),
    ).toBe(false);
    expect(screen.getByText("across 1 recorded session")).toBeTruthy();
  });
  it("allows history review but disables recording when another instance owns focus", async () => {
    state.canControl = false;
    render(app());
    await screen.findByText(
      "Another app instance controls focus recording. You can review this history here.",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Start focus session",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh log" }));
    await waitFor(() =>
      expect(
        mock.invoke.mock.calls.filter(([name]) => name === "get_focus_summary")
          .length,
      ).toBe(2),
    );
    expect(
      mock.invoke.mock.calls.every(([name]) => name === "get_focus_summary"),
    ).toBe(true);
  });
  it("reuses the start request ID when a start response is lost", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    let lost = true;
    mock.invoke.mockImplementation(async (name, args) => {
      const result = await implementation(name, args);
      if (name === "start_focus_session" && lost) {
        lost = false;
        throw { message: "Lost start response" };
      }
      return result;
    });
    render(app());
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Start focus session",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start focus session" }),
    );
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    await screen.findByRole("button", { name: "Finish session" });
    const requests = mock.invoke.mock.calls
      .filter(([name]) => name === "start_focus_session")
      .map(([, args]) => args.requestId);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
  });
});
