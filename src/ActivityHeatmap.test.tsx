import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActivityHeatmap, activityCalendar } from "./ActivityHeatmap";
import { emptyDashboard } from "./backend";
afterEach(cleanup);
describe("saved study activity", () => {
  it("renders a genuinely empty history without active cells", () => {
    render(
      <ActivityHeatmap
        dashboard={{ ...emptyDashboard, localToday: "2026-11-10" }}
        available
      />,
    );
    expect(screen.getByText(/No saved study activity yet/)).toBeTruthy();
    expect(
      document.querySelectorAll(".activity-day.has-activity"),
    ).toHaveLength(0);
    expect(
      screen.getByRole("button", {
        name: "2026-11-10: no saved study activity",
      }),
    ).toBeTruthy();
  });
  it("shows only saved days, with yesterday's continuing streak", () => {
    render(
      <ActivityHeatmap
        dashboard={{
          ...emptyDashboard,
          localToday: "2026-11-10",
          activityDays: ["2026-11-09", "2026-11-08", "2026-12-01"],
          streakDays: 2,
          longestStreakDays: 3,
        }}
        available
      />,
    );
    expect(
      document.querySelectorAll(".activity-day.has-activity"),
    ).toHaveLength(2);
    expect(screen.getByText(/Your streak includes yesterday/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "2026-11-09: saved study activity" }),
    ).toBeTruthy();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Activity history range" }),
      { target: { value: "13" } },
    );
    expect(document.querySelectorAll(".activity-day")).toHaveLength(91);
  });
  it("distinguishes unavailable storage from a saved empty history", () => {
    render(<ActivityHeatmap dashboard={emptyDashboard} available={false} />);
    expect(screen.getByText(/connect local storage/)).toBeTruthy();
    expect(screen.queryByText(/No saved study activity yet/)).toBeNull();
    expect(document.querySelectorAll(".activity-day")).toHaveLength(0);
  });
  it("preserves confirmed days and marks refresh failures", () => {
    render(
      <ActivityHeatmap
        dashboard={{
          ...emptyDashboard,
          localToday: "2026-11-10",
          activityDays: ["2026-11-10"],
        }}
        available
        refreshFailed
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "last confirmed history",
    );
    expect(
      document.querySelectorAll(".activity-day.has-activity"),
    ).toHaveLength(1);
  });
  it("inspects dates by keyboard using one calendar tab stop", () => {
    render(
      <ActivityHeatmap
        dashboard={{
          ...emptyDashboard,
          localToday: "2026-11-10",
          activityDays: ["2026-11-09"],
        }}
        available
      />,
    );
    const today = screen.getByRole("button", {
      name: "2026-11-10: no saved study activity",
    });
    expect(today.tabIndex).toBe(0);
    expect(
      document.querySelectorAll('.activity-day[tabindex="0"]'),
    ).toHaveLength(1);
    today.focus();
    fireEvent.keyDown(today, { key: "ArrowUp" });
    const yesterday = screen.getByRole("button", {
      name: "2026-11-09: saved study activity",
    });
    expect(document.activeElement).toBe(yesterday);
    expect(yesterday.tabIndex).toBe(0);
    expect(today.tabIndex).toBe(-1);
    expect(
      document.querySelector(".activity-day-detail")?.textContent,
    ).toContain("2026-11-09 · Saved study activity");
    fireEvent.keyDown(yesterday, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", {
        name: "2026-11-02: no saved study activity",
      }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", {
        name: "2026-11-07: no saved study activity",
      }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(today);
    expect(
      document.querySelectorAll('.activity-day[tabindex="0"]'),
    ).toHaveLength(1);
  });
  it("keeps local calendar labels stable at leap days and DST boundaries", () => {
    const leap = activityCalendar("2024-03-01", 2);
    expect(leap.some((day) => day.day === "2024-02-29" && !day.future)).toBe(
      true,
    );
    for (const today of ["2026-03-08", "2026-11-01", "2027-01-01"]) {
      const days = activityCalendar(today, 2);
      expect(days).toHaveLength(14);
      expect(new Set(days.map((day) => day.day)).size).toBe(14);
      expect(days.filter((day) => !day.future).at(-1)?.day).toBe(today);
    }
    expect(activityCalendar("")).toEqual([]);
  });
});
