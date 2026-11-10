import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { projects, projectMilestones } from "../curriculum/data";
import type { ProjectMilestone } from "../curriculum/data";
import ProjectProvider from "./ProjectProvider";
import type {
  MilestoneProgress,
  ProjectAction,
  ProjectMutation,
  ProjectSummary,
} from "./ProjectProvider";
import ProjectPage from "./ProjectPage";
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
const first = projectMilestones.find(
  (m) => m.projectId === "project-1" && m.kind === "work",
)!;
const evidence =
  "Reference test output is saved at tests/run.log with compiler setup and limitations.";
const rationale =
  "I checked the reference output, all listed task criteria, and the documented limitations.";
let state: ProjectSummary;
let awards: Set<string>;
let replay: Map<string, { name: string; args: unknown; xp: number }>;
function entry(id: string) {
  return state.milestones.find((m) => m.milestoneId === id)!;
}
function recount() {
  state.projects = projects.map((p) => {
    const defs = projectMilestones.filter((m) => m.projectId === p.id),
      required = defs.filter((m) => !m.optional),
      optional = defs.filter((m) => m.optional);
    const complete = required.filter(
      (m) => entry(m.id).status === "completed",
    ).length;
    return {
      projectId: p.id,
      status:
        complete === required.length
          ? "completed"
          : defs.some((m) => entry(m.id).status !== "not_started")
            ? "in_progress"
            : "not_started",
      requiredMilestones: required.length,
      completedRequiredMilestones: complete,
      optionalMilestones: optional.length,
      completedOptionalMilestones: optional.filter(
        (m) => entry(m.id).status === "completed",
      ).length,
    };
  });
  state.completedRequiredMilestones = state.projects.reduce(
    (n, p) => n + p.completedRequiredMilestones,
    0,
  );
  state.totalXpEarned = awards.size * 50;
}
function reviewed(def: ProjectMilestone) {
  Object.assign(entry(def.id), {
    status: "completed",
    taskChecks: def.tasks.map((t) => ({ taskId: t.id, done: true })),
    evidenceNote: evidence,
    reviewNote: rationale,
    reviewedAt: "2026-11-10T05:00:00Z",
    updatedAt: "2026-11-10T05:00:00Z",
    version: 2,
  });
  awards.add(def.id);
}
function result(id: string, xp: number, replayed = false): ProjectMutation {
  recount();
  return {
    summary: structuredClone(state),
    dashboard: { ...emptyDashboard, totalXp: state.totalXpEarned },
    milestoneId: id,
    xpAwarded: xp,
    replayed,
  };
}
beforeEach(() => {
  mock.native = true;
  vi.clearAllMocks();
  awards = new Set();
  replay = new Map();
  state = {
    projects: [],
    milestones: projectMilestones.map((d) => ({
      milestoneId: d.id,
      status: "not_started",
      taskChecks: d.tasks.map((t) => ({ taskId: t.id, done: false })),
      evidenceNote: "",
      reviewNote: null,
      reviewedAt: null,
      updatedAt: null,
      version: 0,
    })),
    totalRequiredMilestones: projectMilestones.filter((m) => !m.optional)
      .length,
    completedRequiredMilestones: 0,
    totalXpEarned: 0,
    history: [],
  };
  recount();
  mock.invoke.mockImplementation(async (name, args) => {
    if (name === "get_project_summary") return structuredClone(state);
    if (name === "get_dashboard")
      return { ...emptyDashboard, totalXp: state.totalXpEarned };
    if (name === "get_backup_status")
      return {
        restartRequired: false,
        workspaceReplaced: false,
        safetyBackupPath: null,
      };
    if (
      [
        "save_project_milestone",
        "review_project_milestone",
        "reopen_project_milestone",
      ].includes(name)
    ) {
      const prior = replay.get(args.requestId);
      if (prior) return result(args.milestoneId, prior.xp, true);
      const saved = entry(args.milestoneId),
        def = projectMilestones.find((d) => d.id === args.milestoneId)!;
      if (saved.version !== args.expectedVersion)
        throw {
          code: "stale_project_state",
          message: "This milestone changed in another view.",
        };
      let xp = 0;
      const oldStatus = saved.status;
      if (name === "save_project_milestone") {
        Object.assign(saved, {
          taskChecks: structuredClone(args.taskChecks),
          evidenceNote: args.evidenceNote.trim(),
          status: args.status,
          reviewNote: null,
          reviewedAt: null,
        });
      } else if (name === "review_project_milestone") {
        Object.assign(saved, {
          status: "completed",
          reviewNote: args.reviewNote.trim(),
          reviewedAt: "2026-11-10T05:00:00Z",
        });
        if (!awards.has(def.id)) {
          awards.add(def.id);
          xp = 50;
        }
      } else
        Object.assign(saved, {
          status: "in_progress",
          reviewNote: null,
          reviewedAt: null,
        });
      ++saved.version;
      saved.updatedAt = "2026-11-10T05:00:00Z";
      if (
        oldStatus === "completed" &&
        !def.optional &&
        name !== "review_project_milestone"
      ) {
        const exit = projectMilestones.find(
          (d) => d.projectId === def.projectId && d.kind === "exit_review",
        )!;
        if (exit.id !== def.id && entry(exit.id).status === "completed") {
          const old = entry(exit.id);
          Object.assign(old, {
            status: "in_progress",
            reviewNote: null,
            reviewedAt: null,
            version: old.version + 1,
          });
          state.history.unshift({
            requestId: args.requestId,
            milestoneId: exit.id,
            action: "invalidated",
            createdAt: "2026-11-10T05:00:00Z",
            xpAwarded: 0,
            reason: "Required work changed.",
            snapshot: structuredClone(old),
            definition: exit,
          });
        }
      }
      const action: ProjectAction = {
        requestId: args.requestId,
        milestoneId: def.id,
        action:
          name === "save_project_milestone"
            ? "saved"
            : name === "review_project_milestone"
              ? "reviewed"
              : "reopened",
        createdAt: "2026-11-10T05:00:00Z",
        xpAwarded: xp,
        reason: args.reason ?? null,
        snapshot: structuredClone(saved),
        definition: def,
      };
      state.history.unshift(action);
      replay.set(args.requestId, { name, args: structuredClone(args), xp });
      return result(def.id, xp);
    }
  });
});
afterEach(cleanup);
const workspace = () => (
  <ProjectProvider>
    <ProjectPage />
  </ProjectProvider>
);
async function open(projectId = first.projectId) {
  const plan = projects.find((p) => p.id === projectId)!;
  fireEvent.click(
    (await screen.findByRole("heading", { name: plan.title })).closest(
      "button",
    )!,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("textbox", {
          name: "Milestone evidence note",
        }) as HTMLTextAreaElement
      ).disabled,
    ).toBe(false),
  );
}
function select(def: ProjectMilestone) {
  const buttons = within(
    screen.getByRole("navigation", { name: "Project milestones" }),
  ).getAllByRole("button");
  fireEvent.click(buttons.find((b) => b.textContent?.includes(def.title))!);
}
function fillReady(def = first) {
  for (const task of def.tasks)
    fireEvent.click(
      screen.getByRole("checkbox", { name: `Task: ${task.title}` }),
    );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Milestone evidence note" }),
    { target: { value: evidence } },
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "Milestone working status" }),
    { target: { value: "ready_for_review" } },
  );
}
describe("project evidence and explicit self-review", () => {
  it("shows all four source plans but creates no browser progress or mutations", () => {
    mock.native = false;
    render(workspace());
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .filter((h) => projects.some((p) => p.title === h.textContent)),
    ).toHaveLength(4);
    fireEvent.click(
      screen
        .getByRole("heading", { name: projects[0].title })
        .closest("button")!,
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Milestone evidence note",
        }) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Open the desktop app to record your own implementation evidence.",
      ),
    ).toBeTruthy();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("requires saved checked tasks, concrete evidence, rationale and explicit acknowledgement", async () => {
    render(workspace());
    await open();
    expect(
      (
        screen.getByRole("button", {
          name: "Save self-review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fillReady();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Milestone self-review note" }),
      { target: { value: rationale } },
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I reviewed the saved evidence/ }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Save self-review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Save task progress & evidence" }),
    );
    await screen.findByText("Progress and evidence saved locally.");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Milestone self-review note",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(rationale);
    expect(
      (
        screen.getByRole("checkbox", {
          name: /I reviewed the saved evidence/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I reviewed the saved evidence/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save self-review" }));
    await screen.findByText("Self-review saved. +50 XP earned once.");
    expect(mock.invoke).toHaveBeenCalledWith("review_project_milestone", {
      milestoneId: first.id,
      reviewNote: rationale,
      confirmReviewed: true,
      expectedVersion: 1,
      requestId: expect.any(String),
    });
    expect(entry(first.id).status).toBe("completed");
    expect(state.totalXpEarned).toBe(50);
    expect(screen.getByText("YOUR SAVED SELF-REVIEW")).toBeTruthy();
  });
  it("updates the main dashboard with authoritative project XP and keeps drafts across navigation", async () => {
    render(
      <ProjectProvider>
        <App />
      </ProjectProvider>,
    );
    await screen.findByText("Local database connected");
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).getByRole("button", { name: "Projects" }),
    );
    await open();
    fillReady();
    fireEvent.click(
      screen.getByRole("button", { name: "Save task progress & evidence" }),
    );
    await screen.findByText("Progress and evidence saved locally.");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Milestone self-review note" }),
      { target: { value: rationale } },
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I reviewed the saved evidence/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save self-review" }));
    await screen.findByText("Self-review saved. +50 XP earned once.");
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).getByRole("button", { name: "Overview" }),
    );
    expect(
      within(
        screen.getByText("TOTAL EXPERIENCE").closest("section")!,
      ).getByText("50"),
    ).toBeTruthy();
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).getByRole("button", { name: "Projects" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Milestone evidence note" }),
      { target: { value: evidence + " A new unsaved artifact note." } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Systems explorer Level/ }),
    );
    await screen.findByText(
      /1 project milestone has unsaved task, evidence, or review drafts/,
    );
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Main navigation" }),
      ).getByRole("button", { name: "Projects" }),
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Milestone evidence note",
        }) as HTMLTextAreaElement
      ).value,
    ).toContain("A new unsaved artifact note.");
  });
  it("keeps optional stretch work separate and allows a final review after all required work", async () => {
    const plan = "project-4";
    for (const d of projectMilestones.filter(
      (m) => m.projectId === plan && !m.optional && m.kind !== "exit_review",
    ))
      reviewed(d);
    const exit = projectMilestones.find(
      (m) => m.projectId === plan && m.kind === "exit_review",
    )!;
    Object.assign(entry(exit.id), {
      status: "ready_for_review",
      taskChecks: exit.tasks.map((t) => ({ taskId: t.id, done: true })),
      evidenceNote: evidence,
      version: 1,
    });
    recount();
    render(workspace());
    await open(plan);
    select(exit);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Milestone self-review note" }),
      { target: { value: rationale } },
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I reviewed the saved evidence/ }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Save self-review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      projectMilestones
        .filter((m) => m.projectId === plan && m.optional)
        .every((m) => entry(m.id).status === "not_started"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save self-review" }));
    await screen.findByText("YOUR SAVED SELF-REVIEW");
    expect(state.projects.find((p) => p.projectId === plan)?.status).toBe(
      "completed",
    );
  });
  it("does not permit exit review while required implementation evidence is still incomplete", async () => {
    const exit = projectMilestones.find(
      (m) => m.projectId === "project-1" && m.kind === "exit_review",
    )!;
    Object.assign(entry(exit.id), {
      status: "ready_for_review",
      taskChecks: exit.tasks.map((t) => ({ taskId: t.id, done: true })),
      evidenceNote: evidence,
      version: 1,
    });
    recount();
    render(workspace());
    await open();
    select(exit);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Milestone self-review note" }),
      { target: { value: rationale } },
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I reviewed the saved evidence/ }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Save self-review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/other required milestones still need self-review/),
    ).toBeTruthy();
    expect(
      mock.invoke.mock.calls.some(
        ([name]) => name === "review_project_milestone",
      ),
    ).toBe(false);
  });
  it("reopens reviewed required evidence and its exit review without farming prior XP", async () => {
    for (const d of projectMilestones.filter(
      (m) => m.projectId === "project-1" && !m.optional,
    ))
      reviewed(d);
    recount();
    const priorXp = state.totalXpEarned;
    render(workspace());
    await open();
    select(first);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Milestone evidence note" }),
      { target: { value: evidence + " Corrected measurement boundary." } },
    );
    await screen.findByText(/Saving changes reopens this milestone/);
    fireEvent.click(
      screen.getByRole("button", { name: "Save task progress & evidence" }),
    );
    await screen.findByText("Progress and evidence saved locally.");
    expect(entry(first.id).status).toBe("in_progress");
    expect(
      entry(
        projectMilestones.find(
          (m) => m.projectId === "project-1" && m.kind === "exit_review",
        )!.id,
      ).status,
    ).toBe("in_progress");
    expect(state.totalXpEarned).toBe(priorXp);
    expect(screen.getByText("Final exit review reopened")).toBeTruthy();
  });
  it("reopens with an explicit reason and retains the saved historical evidence", async () => {
    reviewed(first);
    recount();
    render(workspace());
    await open();
    select(first);
    const reason = "The correctness fixture needs another boundary case.";
    fireEvent.change(
      screen.getByRole("textbox", { name: "Reason to reopen milestone" }),
      { target: { value: reason } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Reopen milestone" }));
    await screen.findByText(
      "Milestone reopened for work. Earlier XP and history are retained.",
    );
    expect(mock.invoke).toHaveBeenCalledWith("reopen_project_milestone", {
      milestoneId: first.id,
      reason,
      expectedVersion: 2,
      requestId: expect.any(String),
    });
    expect(entry(first.id).evidenceNote).toBe(evidence);
    expect(state.totalXpEarned).toBe(50);
  });
  it("retries an uncertain mutation with the same immutable payload and request ID", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    let lost = true;
    mock.invoke.mockImplementation(async (name, args) => {
      const answer = await implementation(name, args);
      if (name === "save_project_milestone" && lost) {
        lost = false;
        throw { message: "Project response lost" };
      }
      return answer;
    });
    render(workspace());
    await open();
    fillReady();
    fireEvent.click(
      screen.getByRole("button", { name: "Save task progress & evidence" }),
    );
    await screen.findByRole("button", { name: "Retry pending project action" });
    expect(
      (
        screen.getByRole("button", {
          name: "Refresh saved state",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Milestone evidence note",
        }) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry pending project action" }),
    );
    await screen.findByText(
      "Earlier action confirmed; no duplicate reward was recorded.",
    );
    const calls = mock.invoke.mock.calls
      .filter(([name]) => name === "save_project_milestone")
      .map(([, args]) => args);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(state.history.filter((h) => h.action === "saved")).toHaveLength(1);
  });
  it("preserves drafts on actual backend version conflicts until explicit reload", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation(async (name, args) => {
      if (name === "save_project_milestone") {
        Object.assign(entry(first.id), {
          version: 1,
          status: "in_progress",
          evidenceNote: "An external saved evidence note with real context.",
        });
        throw {
          code: "stale_project_state",
          message: "This milestone changed in another view.",
        };
      }
      return implementation(name, args);
    });
    render(workspace());
    await open();
    fillReady();
    fireEvent.click(
      screen.getByRole("button", { name: "Save task progress & evidence" }),
    );
    await screen.findByRole("button", {
      name: "Discard local draft and load saved state",
    });
    expect(
      (
        screen.getByRole("textbox", {
          name: "Milestone evidence note",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(evidence);
    expect(
      screen.queryByRole("button", { name: "Retry pending project action" }),
    ).toBeNull();
    fireEvent.click(screen.getByText("View current saved evidence"));
    expect(
      screen.getByText("An external saved evidence note with real context."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard local draft and load saved state",
      }),
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Milestone evidence note",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("An external saved evidence note with real context.");
  });
  it("does not rebase old review rationale onto a newer returned milestone version", async () => {
    const implementation = mock.invoke.getMockImplementation()!;
    mock.invoke.mockImplementation(async (name, args) => {
      const answer = await implementation(name, args);
      if (name === "save_project_milestone") {
        Object.assign(entry(first.id), {
          version: 2,
          evidenceNote:
            "A later edit from another instance requires a fresh review.",
        });
        return result(first.id, 0);
      }
      return answer;
    });
    render(workspace());
    await open();
    fillReady();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Milestone self-review note" }),
      { target: { value: rationale } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save task progress & evidence" }),
    );
    await screen.findByText(
      "Your action was recorded, and this milestone changed again. Compare the saved state with your preserved draft.",
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Milestone evidence note",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(evidence);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Milestone self-review note",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(rationale);
    expect(
      screen.getByRole("button", {
        name: "Discard local draft and load saved state",
      }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Save self-review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
