import { describe, expect, it } from "vitest";
import { modules, phases } from "../curriculum/data";
import { nextReadingTopic } from "./recommendation";
describe("reading recommendations", () => {
  it("keeps unfinished parallel Phase 1 work ahead of Phase 2 even when seed order differs", () => {
    const progress = modules
      .filter((m) => m.phaseId === "phase-1" && m.id !== "rtl-foundations")
      .map((m) => ({ topicId: m.id, status: "read" }));
    expect(nextReadingTopic(modules, phases, progress)?.id).toBe(
      "rtl-foundations",
    );
  });
  it("moves to the first actual Phase 2 module after Phase 1 reading is marked read", () => {
    const progress = modules
      .filter((m) => m.phaseId === "phase-1")
      .map((m) => ({ topicId: m.id, status: "read" }));
    expect(nextReadingTopic(modules, phases, progress)?.phaseId).toBe(
      "phase-2",
    );
  });
  it("does not invent another unread topic after all reading is marked read", () => {
    expect(
      nextReadingTopic(
        modules,
        phases,
        modules.map((m) => ({ topicId: m.id, status: "read" })),
      ),
    ).toBeNull();
  });
});
