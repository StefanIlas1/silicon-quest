import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import BackupPanel from "./BackupPanel";
import type { BackupPreview, RestoreResult } from "./BackupPanel";
import RestoreBoundary from "./RestoreBoundary";
import { RestoreContext } from "./restoreContext";
import FocusProvider from "./FocusProvider";
import { FocusContext, FocusPage, emptyFocusSummary } from "./Focus";
import ReviewProvider from "./ReviewProvider";
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
const preview: BackupPreview = {
  previewToken: "opaque-preview-token",
  fileName: "silicon-quest-backup.sqlite",
  createdAt: "2026-11-10T05:00:00Z",
  sourceSchemaVersion: 4,
  currentSchemaVersion: 5,
  bytes: 4096,
  counts: {
    topics: 24,
    attempts: 5,
    notes: 3,
    pdfs: 2,
    pdfBytes: 2048,
    focusSessions: 4,
    trackedSeconds: 125,
    reviewTopics: 3,
    totalXp: 180,
  },
  interruptedSessions: 1,
};
const restored: RestoreResult = {
  restored: true,
  restartRequired: true,
  safetyBackupFileName: "before-restore.sqlite",
  safetyBackupPath: "/private/test-data/recovery/before-restore.sqlite",
  counts: preview.counts,
};
beforeEach(() => {
  mock.native = true;
  vi.clearAllMocks();
  mock.invoke.mockImplementation(async (name) => {
    if (name === "get_backup_status")
      return {
        restartRequired: false,
        workspaceReplaced: false,
        safetyBackupPath: null,
      };
    if (name === "inspect_local_backup") return structuredClone(preview);
    if (name === "restore_local_backup") return structuredClone(restored);
    if (name === "export_local_backup")
      return {
        fileName: "my-local-backup.sqlite",
        bytes: 4096,
        createdAt: "2026-11-10T05:00:00Z",
      };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function inspect() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Choose backup to inspect" }),
  );
  await screen.findByRole("heading", { name: "Review before replacing data." });
}
async function confirm() {
  await inspect();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Replace local data" }));
}
describe("explicit local backups", () => {
  it("opens only the restart screen when a refreshed webview sees a replaced workspace", async () => {
    mock.invoke.mockResolvedValue({
      restartRequired: true,
      workspaceReplaced: true,
      safetyBackupPath: restored.safetyBackupPath,
    });
    render(
      <RestoreBoundary>
        <ReviewProvider>
          <FocusProvider>
            <span>Learning workspace</span>
          </FocusProvider>
        </ReviewProvider>
      </RestoreBoundary>,
    );
    await screen.findByRole("button", { name: "Restart Silicon Quest" });
    expect(screen.queryByText("Learning workspace")).toBeNull();
    expect(
      mock.invoke.mock.calls.every(([name]) => name === "get_backup_status"),
    ).toBe(true);
    expect(screen.getByText(restored.safetyBackupPath!)).toBeTruthy();
    expect(screen.queryByText("5 quiz attempts")).toBeNull();
  });
  it("keeps learner providers closed until workspace status can be checked", async () => {
    let failed = true;
    mock.invoke.mockImplementation(async () => {
      if (failed) throw { message: "Status unavailable" };
      return {
        restartRequired: false,
        workspaceReplaced: false,
        safetyBackupPath: null,
      };
    });
    render(
      <RestoreBoundary>
        <span>Learning workspace</span>
      </RestoreBoundary>,
    );
    await screen.findByRole("button", { name: "Retry workspace check" });
    expect(screen.queryByText("Learning workspace")).toBeNull();
    failed = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Retry workspace check" }),
    );
    await screen.findByText("Learning workspace");
  });
  it("resolves a lost restore reply through the authoritative restart status", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    let committed = false;
    mock.invoke.mockImplementation(async (name, args) => {
      if (name === "restore_local_backup") {
        committed = true;
        throw { message: "Restore acknowledgement lost" };
      }
      if (name === "get_backup_status" && committed)
        return {
          restartRequired: true,
          workspaceReplaced: false,
          safetyBackupPath: restored.safetyBackupPath,
        };
      return implementation(name, args);
    });
    render(
      <RestoreBoundary>
        <BackupPanel />
      </RestoreBoundary>,
    );
    await confirm();
    await screen.findByRole("button", { name: "Restart Silicon Quest" });
    expect(
      screen.queryByRole("button", { name: "Retry restore confirmation" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Choose backup to inspect" }),
    ).toBeNull();
    expect(screen.getByText(restored.safetyBackupPath!)).toBeTruthy();
    expect(
      mock.invoke.mock.calls.filter(
        ([name]) => name === "restore_local_backup",
      ),
    ).toHaveLength(1);
  });
  it("does not access backups on mount and keeps browser controls unavailable", () => {
    mock.native = false;
    render(<BackupPanel />);
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "Export local backup",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Choose backup to inspect",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/This browser preview cannot export or replace/),
    ).toBeTruthy();
  });
  it("exports only after a user action and reports the actual native result", async () => {
    render(<BackupPanel unsavedNotes={2} />);
    expect(
      mock.invoke.mock.calls.every(([name]) => name === "get_backup_status"),
    ).toBe(true);
    expect(screen.getByText(/2 topics have unsaved note drafts/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Export local backup" }),
    );
    await screen.findByText(/Saved my-local-backup.sqlite/);
    expect(
      mock.invoke.mock.calls.filter(([name]) => name === "export_local_backup"),
    ).toHaveLength(1);
    expect(mock.invoke).toHaveBeenCalledWith("export_local_backup");
  });
  it("treats cancelled native dialogs as cancellation without a restore action", async () => {
    mock.invoke.mockImplementation(async (name) =>
      name === "get_backup_status"
        ? {
            restartRequired: false,
            workspaceReplaced: false,
            safetyBackupPath: null,
          }
        : null,
    );
    render(<BackupPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: "Choose backup to inspect" }),
    );
    await screen.findByText("No backup selected.");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Export local backup" }),
    );
    await screen.findByText("Backup export cancelled.");
    expect(
      mock.invoke.mock.calls.some(([name]) => name === "restore_local_backup"),
    ).toBe(false);
  });
  it("shows inspected contents, requires explicit acknowledgement and exposes recovery before restart", async () => {
    render(
      <RestoreBoundary>
        <BackupPanel unsavedNotes={2} />
      </RestoreBoundary>,
    );
    await inspect();
    expect(screen.getByText("silicon-quest-backup.sqlite")).toBeTruthy();
    expect(screen.getByText("Schema 4 → 5")).toBeTruthy();
    expect(
      screen.getByText(
        "You currently have 2 unsaved note drafts. Restoring and restarting discards them.",
      ),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Replace local data",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      mock.invoke.mock.calls.some(([name]) => name === "restore_local_backup"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Replace local data" }));
    await screen.findByText(
      "/private/test-data/recovery/before-restore.sqlite",
    );
    expect(mock.invoke).toHaveBeenCalledWith("restore_local_backup", {
      previewToken: "opaque-preview-token",
    });
    expect(
      screen.queryByRole("button", { name: "Export local backup" }),
    ).toBeNull();
    expect(
      mock.invoke.mock.calls.some(([name]) => name === "restart_after_restore"),
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Restart Silicon Quest" }),
    );
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("restart_after_restore"),
    );
  });
  it("cancels a staged preview without requesting replacement", async () => {
    render(<BackupPanel />);
    await inspect();
    fireEvent.click(screen.getByRole("button", { name: "Cancel restore" }));
    await screen.findByText("Restore cancelled. No replacement was requested.");
    expect(mock.invoke).toHaveBeenCalledWith("discard_backup_preview", {
      previewToken: "opaque-preview-token",
    });
    expect(
      mock.invoke.mock.calls.some(([name]) => name === "restore_local_backup"),
    ).toBe(false);
  });
  it("reports invalid backup inspection without presenting replacement controls", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation(async (name, args) => {
      if (name === "inspect_local_backup")
        throw { message: "Unsupported backup schema" };
      return implementation(name, args);
    });
    render(<BackupPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: "Choose backup to inspect" }),
    );
    await screen.findByText(
      "Could not inspect this backup: Unsupported backup schema",
    );
    expect(
      screen.queryByRole("button", { name: "Replace local data" }),
    ).toBeNull();
    expect(
      mock.invoke.mock.calls.some(([name]) => name === "restore_local_backup"),
    ).toBe(false);
  });
  it("retries the same token when a restore outcome is uncertain", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    let lost = true;
    mock.invoke.mockImplementation(async (name, args) => {
      if (name === "restore_local_backup" && lost) {
        lost = false;
        throw { message: "Restore reply lost" };
      }
      return implementation(name, args);
    });
    render(<BackupPanel />);
    await confirm();
    await screen.findByText(/Restore was not confirmed: Restore reply lost/);
    expect(
      screen.queryByRole("button", { name: "Restart Silicon Quest" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry restore confirmation" }),
    );
    await screen.findByRole("button", { name: "Restart Silicon Quest" });
    const tokens = mock.invoke.mock.calls
      .filter(([name]) => name === "restore_local_backup")
      .map(([, args]) => args.previewToken);
    expect(tokens).toEqual(["opaque-preview-token", "opaque-preview-token"]);
  });
  it("keeps committed restore visible and gives a manual recovery path if restart fails", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation(async (name, args) => {
      if (name === "restart_after_restore")
        throw { message: "Restart unavailable" };
      return implementation(name, args);
    });
    render(<BackupPanel />);
    await confirm();
    fireEvent.click(
      await screen.findByRole("button", { name: "Restart Silicon Quest" }),
    );
    await screen.findByText(
      /Quit and reopen Silicon Quest to load the restored data/,
    );
    expect(
      screen.getByText("/private/test-data/recovery/before-restore.sqlite"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Replace local data" }),
    ).toBeNull();
  });
  it("requires an active focus session to finish before replacing data", async () => {
    const finish = vi.fn(async () => {});
    const control = {
      summary: {
        ...emptyFocusSummary,
        activeSession: {
          id: "focus-active",
          topicId: "cache-locality",
          status: "active" as const,
          durationSeconds: 10,
          startedAt: "2026-11-10T05:00:00Z",
          endedAt: null,
          excludedGapCount: 0,
        },
      },
      available: true,
      readOnly: false,
      loading: false,
      busy: false,
      error: "",
      acknowledgedAt: 0,
      begin: vi.fn(async () => {}),
      finish,
      refresh: vi.fn(async () => {}),
    };
    const view = render(
      <FocusContext.Provider value={control}>
        <BackupPanel />
      </FocusContext.Provider>,
    );
    await inspect();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(
      (
        screen.getByRole("button", {
          name: "Replace local data",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Finish active focus session" }),
    );
    expect(finish).toHaveBeenCalledTimes(1);
    view.rerender(
      <FocusContext.Provider value={{ ...control, summary: emptyFocusSummary }}>
        <BackupPanel />
      </FocusContext.Provider>,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Replace local data",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("tears down polling and skips queued focus mutations at the restore boundary", async () => {
    vi.useFakeTimers();
    const active = {
      id: "focus-session-1",
      topicId: "cache-locality",
      status: "active",
      startedAt: "2026-11-10T05:00:00Z",
      endedAt: null,
      updatedAt: "2026-11-10T05:00:00Z",
      elapsedSeconds: 10,
      sequence: 1,
      excludedGapCount: 0,
    };
    let rejectTick: (e: unknown) => void = () => {};
    mock.invoke.mockImplementation(async (name) => {
      if (name === "get_backup_status")
        return {
          restartRequired: false,
          workspaceReplaced: false,
          safetyBackupPath: null,
        };
      if (name === "get_focus_summary")
        return {
          activeSession: active,
          sessions: [active],
          totalSeconds: 10,
          completedSessions: 0,
          interruptedSessions: 0,
          todaySeconds: 10,
          todayDate: "2026-11-10",
          topicSeconds: [],
          canControl: true,
        };
      if (name === "get_review_summary")
        return {
          asOf: "2026-11-10T05:00:00Z",
          due: [],
          upcoming: [],
          masteredCount: 0,
          totalScheduled: 0,
          evidenceRequired: 3,
          intervalDays: [1, 3, 7, 14, 30],
          policyVersion: 1,
          events: [],
        };
      if (name === "tick_focus_session")
        return new Promise((_, reject) => {
          rejectTick = reject;
        });
    });
    function Harness() {
      const commit = useContext(RestoreContext)!;
      return (
        <>
          <FocusPage />
          <button onClick={() => commit(restored)}>Commit test restore</button>
        </>
      );
    }
    await act(async () => {
      render(
        <RestoreBoundary>
          <ReviewProvider>
            <FocusProvider>
              <Harness />
            </FocusProvider>
          </ReviewProvider>
        </RestoreBoundary>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Finish session" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Commit test restore" }),
    );
    await act(async () => {
      rejectTick({ code: "invalid_sequence", message: "Old state" });
    });
    expect(screen.queryByRole("button", { name: "Finish session" })).toBeNull();
    const calls = mock.invoke.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(mock.invoke.mock.calls.length).toBe(calls);
    expect(
      mock.invoke.mock.calls.some(([name]) => name === "end_focus_session"),
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: "Restart Silicon Quest" }),
    ).toBeTruthy();
  });
});
