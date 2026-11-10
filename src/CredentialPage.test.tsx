import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { credentials } from "../curriculum/data";
import CredentialProvider from "./CredentialProvider";
import type {
  CredentialAction,
  CredentialMutation,
  CredentialSummary,
} from "./CredentialProvider";
import CredentialPage, { calendarDate } from "./CredentialPage";
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
const note =
  "I completed the stated course assessment and saved its actual provider outcome for my own records.";
const reference = "Local evidence: documents/course-outcome.txt";
let summary: CredentialSummary;
let requests: Map<string, CredentialAction>;
function totals() {
  summary.completedCount = summary.items.filter(
    (p) => p.status === "completed",
  ).length;
  summary.inProgressCount = summary.items.filter(
    (p) => p.status === "in_progress",
  ).length;
  summary.notPursuingCount = summary.items.filter(
    (p) => p.status === "not_pursuing",
  ).length;
}
function result(id: string, replayed = false): CredentialMutation {
  totals();
  return { summary: structuredClone(summary), credentialId: id, replayed };
}
beforeEach(() => {
  mock.native = true;
  vi.clearAllMocks();
  requests = new Map();
  summary = {
    items: credentials.map((d) => ({
      credentialId: d.id,
      status: "not_started",
      targetDate: null,
      evidenceNote: "",
      evidenceReference: "",
      completedAt: null,
      updatedAt: null,
      version: 0,
    })),
    history: [],
    totalItems: 4,
    inProgressCount: 0,
    completedCount: 0,
    notPursuingCount: 0,
  };
  mock.invoke.mockImplementation(async (name, args) => {
    if (name === "get_local_artwork") return null;
    if (name === "get_credential_summary") return structuredClone(summary);
    if (name === "get_dashboard") return { ...emptyDashboard };
    if (name === "get_backup_status")
      return {
        restartRequired: false,
        workspaceReplaced: false,
        safetyBackupPath: null,
      };
    if (name === "save_credential_progress") {
      if (requests.has(args.requestId)) return result(args.credentialId, true);
      const item = summary.items.find(
        (p) => p.credentialId === args.credentialId,
      )!;
      if (item.version !== args.expectedVersion)
        throw {
          code: "stale_credential_state",
          message: "This personal course record changed elsewhere.",
        };
      Object.assign(item, {
        status: args.status,
        targetDate: args.targetDate,
        evidenceNote: args.evidenceNote.trim(),
        evidenceReference: args.evidenceReference.trim(),
        completedAt:
          args.status === "completed" ? "2026-11-10T06:00:00Z" : null,
        updatedAt: "2026-11-10T06:00:00Z",
        version: item.version + 1,
      });
      const action: CredentialAction = {
        requestId: args.requestId,
        credentialId: item.credentialId,
        action: "saved",
        createdAt: "2026-11-10T06:00:00Z",
        snapshot: structuredClone(item),
        definition: credentials.find((d) => d.id === item.credentialId),
      };
      requests.set(args.requestId, action);
      summary.history.unshift(action);
      return result(item.credentialId);
    }
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const page = () => (
  <CredentialProvider>
    <CredentialPage />
  </CredentialProvider>
);
async function loaded() {
  await waitFor(() =>
    expect(
      (
        screen.getByRole("combobox", {
          name: "Personal credential status",
        }) as HTMLSelectElement
      ).disabled,
    ).toBe(false),
  );
}
function reportCompletion() {
  fireEvent.change(
    screen.getByRole("combobox", { name: "Personal credential status" }),
    { target: { value: "completed" } },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Credential evidence note" }),
    { target: { value: note } },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Credential evidence reference" }),
    { target: { value: reference } },
  );
}
describe("personal course and credential tracking", () => {
  it("keeps all browser records unavailable and preserves the four authored credential distinctions", () => {
    mock.native = false;
    render(page());
    expect(
      (
        screen.getByRole("button", {
          name: "Save personal course record",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Browser preview shows the four roadmap plans only. No course status, target date, or completion evidence is recorded here.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("complementary", { name: "Credential plans" })
        .querySelectorAll("button"),
    ).toHaveLength(4);
    expect(screen.getByText("Formal certification exam")).toBeTruthy();
    expect(screen.getByText("Additional coursework")).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("requires concrete context and an exact-draft self-report acknowledgement before completion", async () => {
    render(page());
    await loaded();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Personal credential status" }),
      { target: { value: "completed" } },
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Save personal course record",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    reportCompletion();
    expect(
      (
        screen.getByRole("button", {
          name: "Save personal course record",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I checked the provider/ }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Credential evidence reference" }),
      { target: { value: reference + " revised" } },
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: /I checked the provider/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I checked the provider/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save personal course record" }),
    );
    await screen.findByText(
      "Personal course status and evidence saved. No XP or mastery changed.",
    );
    expect(mock.invoke).toHaveBeenCalledWith("save_credential_progress", {
      credentialId: "cuda-dli",
      status: "completed",
      targetDate: null,
      evidenceNote: note,
      evidenceReference: reference + " revised",
      confirmCompleted: true,
      expectedVersion: 0,
      requestId: expect.any(String),
    });
    expect(summary.completedCount).toBe(1);
    expect(
      screen.getByText(/This is the report time, not an official award date/),
    ).toBeTruthy();
    expect(
      mock.invoke.mock.calls.every(
        ([name]) =>
          name === "get_credential_summary" ||
          name === "get_local_artwork" ||
          name === "save_credential_progress",
      ),
    ).toBe(true);
  });
  it("saves a personal calendar target unchanged and never converts it into a booking", async () => {
    render(page());
    await loaded();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Personal credential status" }),
      { target: { value: "in_progress" } },
    );
    fireEvent.change(screen.getByLabelText("Personal target date"), {
      target: { value: "2027-01-05" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save personal course record" }),
    );
    await screen.findByText(
      "Personal course status and evidence saved. No XP or mastery changed.",
    );
    expect(mock.invoke).toHaveBeenCalledWith(
      "save_credential_progress",
      expect.objectContaining({
        targetDate: "2027-01-05",
        status: "in_progress",
        confirmCompleted: false,
      }),
    );
    expect(summary.items[0].targetDate).toBe("2027-01-05");
    const format = vi
      .spyOn(Date.prototype, "toLocaleDateString")
      .mockImplementation(function (this: Date) {
        return new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Toronto",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(this);
      });
    expect(calendarDate("2027-01-05")).toBe("2027-01-05");
    format.mockRestore();
  });
  it("allows not pursuing any roadmap plan without claiming completion", async () => {
    render(page());
    await loaded();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Personal credential status" }),
      { target: { value: "not_pursuing" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save personal course record" }),
    );
    await screen.findByText(
      "Personal course status and evidence saved. No XP or mastery changed.",
    );
    expect(summary.notPursuingCount).toBe(1);
    expect(summary.completedCount).toBe(0);
    expect(summary.items[0].completedAt).toBeNull();
  });
  it("clears current completion when status changes while retaining historical self-report", async () => {
    Object.assign(summary.items[0], {
      status: "completed",
      evidenceNote: note,
      evidenceReference: reference,
      completedAt: "2026-11-09T05:00:00Z",
      version: 1,
    });
    totals();
    render(page());
    await loaded();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Personal credential status" }),
      { target: { value: "on_hold" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save personal course record" }),
    );
    await screen.findByText(
      "Personal course status and evidence saved. No XP or mastery changed.",
    );
    expect(summary.completedCount).toBe(0);
    expect(summary.items[0].evidenceNote).toBe(note);
    expect(summary.items[0].completedAt).toBeNull();
    expect(screen.queryByText(/Completion self-reported on/)).toBeNull();
  });
  it("preserves course drafts through navigation and warns separately in local backup settings", async () => {
    render(
      <CredentialProvider>
        <App />
      </CredentialProvider>,
    );
    await screen.findByText("Local database connected");
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).getByRole("button", { name: "Courses" }),
    );
    await loaded();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Credential evidence note" }),
      { target: { value: "My saved-for-later personal study draft." } },
    );
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).getByRole("button", { name: "Overview" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).getByRole("button", { name: "Courses" }),
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Credential evidence note",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("My saved-for-later personal study draft.");
    fireEvent.click(
      screen.getByRole("button", { name: /Systems explorer Level/ }),
    );
    await screen.findByText(
      /1 personal course plan has unsaved status, date, or evidence drafts/,
    );
    expect(
      mock.invoke.mock.calls.some(
        ([name]) => name === "save_credential_progress",
      ),
    ).toBe(false);
  });
  it("retries an uncertain update with its original immutable request and no duplicate history", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    let lost = true;
    mock.invoke.mockImplementation(async (name, args) => {
      const answer = await implementation(name, args);
      if (name === "save_credential_progress" && lost) {
        lost = false;
        throw { message: "Course update response lost" };
      }
      return answer;
    });
    render(page());
    await loaded();
    reportCompletion();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I checked the provider/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save personal course record" }),
    );
    await screen.findByRole("button", { name: "Retry pending course update" });
    expect(
      (
        screen.getByRole("textbox", {
          name: "Credential evidence note",
        }) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry pending course update" }),
    );
    await screen.findByText(
      "Earlier update confirmed. No duplicate history entry was added.",
    );
    const actions = mock.invoke.mock.calls
      .filter(([name]) => name === "save_credential_progress")
      .map(([, args]) => args);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual(actions[1]);
    expect(summary.history).toHaveLength(1);
  });
  it("preserves stale drafts until an explicit reload instead of overwriting another record", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation(async (name, args) => {
      if (name === "save_credential_progress") {
        Object.assign(summary.items[0], {
          version: 1,
          status: "on_hold",
          evidenceNote: "A newer personal record from another app view.",
        });
        throw {
          code: "stale_credential_state",
          message: "This personal course record changed elsewhere.",
        };
      }
      return implementation(name, args);
    });
    render(page());
    await loaded();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Credential evidence note" }),
      { target: { value: note } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save personal course record" }),
    );
    await screen.findByRole("button", {
      name: "Discard local course draft and reload",
    });
    expect(
      (
        screen.getByRole("textbox", {
          name: "Credential evidence note",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(note);
    expect(
      screen.queryByRole("button", { name: "Retry pending course update" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard local course draft and reload",
      }),
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Credential evidence note",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("A newer personal record from another app view.");
  });
  it("keeps original drafts when the success reply contains a later external version", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation(async (name, args) => {
      const answer = await implementation(name, args);
      if (name === "save_credential_progress") {
        Object.assign(summary.items[0], {
          version: 2,
          evidenceNote:
            "Later saved evidence requires a fresh personal report.",
        });
        return result("cuda-dli");
      }
      return answer;
    });
    render(page());
    await loaded();
    reportCompletion();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I checked the provider/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save personal course record" }),
    );
    await screen.findByText(
      "Your update was recorded, then this course record changed again. Compare your preserved draft with the current saved state.",
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Credential evidence note",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(note);
    expect(
      (
        screen.getByRole("button", {
          name: "Save personal course record",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", {
        name: "Discard local course draft and reload",
      }),
    ).toBeTruthy();
  });
  it("validates UTF-8 reference limits before making a save request", async () => {
    render(page());
    await loaded();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Credential evidence reference" }),
      { target: { value: "é".repeat(1100) } },
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Save personal course record",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Shorten the evidence note or reference to fit the saved text limits.",
      ),
    ).toBeTruthy();
    expect(
      mock.invoke.mock.calls.some(
        ([name]) => name === "save_credential_progress",
      ),
    ).toBe(false);
  });
});
