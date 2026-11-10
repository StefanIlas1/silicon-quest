import { useRef, useState } from "react";
import type { Dashboard } from "./backend";
import "./ActivityHeatmap.css";

// These are calendar-only dates. UTC arithmetic keeps the grid independent of
// browser timezone and daylight-saving changes; the store supplies localToday.
const dateOf = (day: string) => new Date(`${day}T12:00:00Z`);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
export function activityCalendar(today: string, weeks = 26) {
  const end = dateOf(today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(end.getTime()))
    return [];
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (weeks - 1) * 7 - start.getUTCDay());
  const days: { day: string; future: boolean; month: string }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    days.push({
      day: isoDay(date),
      future: date > end,
      month: date.toLocaleDateString(undefined, {
        month: "short",
        timeZone: "UTC",
      }),
    });
  }
  return days;
}
export function ActivityHeatmap({
  dashboard,
  available,
  loading = false,
  refreshFailed = false,
}: {
  dashboard: Dashboard;
  available: boolean;
  loading?: boolean;
  refreshFailed?: boolean;
}) {
  const [weeks, setWeeks] = useState(26);
  const [selectedDay, setSelectedDay] = useState("");
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  // An unavailable database never renders an invented empty activity history.
  const days = available ? activityCalendar(dashboard.localToday, weeks) : [];
  const saved = new Set(dashboard.activityDays);
  const activeCount = days.filter((d) => !d.future && saved.has(d.day)).length;
  const studiedToday = saved.has(dashboard.localToday);
  const inspectedDay = days.some(
    (day) => day.day === selectedDay && !day.future,
  )
    ? selectedDay
    : dashboard.localToday;
  function inspectFromKey(key: string, index: number) {
    let target: number;
    switch (key) {
      case "ArrowLeft":
        target = index - 7;
        break;
      case "ArrowRight":
        target = index + 7;
        break;
      case "ArrowUp":
        target = index - 1;
        break;
      case "ArrowDown":
        target = index + 1;
        break;
      case "Home":
        target = index - (index % 7);
        break;
      case "End":
        target = index + 6 - (index % 7);
        break;
      default:
        return false;
    }
    const last = days.findIndex((day) => day.day === dashboard.localToday);
    const day = days[Math.max(0, Math.min(last, target))]?.day;
    if (day) dayButtons.current.get(day)?.focus();
    return true;
  }
  return (
    <section className="activity-panel panel" aria-labelledby="activity-title">
      <div className="activity-heading">
        <div>
          <span className="eyebrow">STUDY HISTORY</span>
          <h2 id="activity-title">Study activity</h2>
        </div>
        {available && (
          <label className="activity-range">
            Show{" "}
            <select
              aria-label="Activity history range"
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
            >
              <option value={13}>13 weeks</option>
              <option value={26}>26 weeks</option>
              <option value={52}>52 weeks</option>
            </select>
          </label>
        )}
      </div>
      {!available ? (
        <p className="activity-message">
          {loading
            ? "Loading saved activity…"
            : "Open the desktop app and connect local storage to see saved study history."}
        </p>
      ) : (
        <>
          {refreshFailed && (
            <p className="activity-message" role="status">
              Showing the last confirmed history. Activity could not refresh;
              retrying automatically.
            </p>
          )}
          <div className="activity-stats">
            <span>
              <strong>{dashboard.streakDays}</strong> day
              {dashboard.streakDays === 1 ? "" : "s"} in your current streak
            </span>
            <span>
              <strong>{dashboard.longestStreakDays}</strong> day
              {dashboard.longestStreakDays === 1 ? "" : "s"} longest streak
            </span>
            <span>
              <strong>{activeCount}</strong> active day
              {activeCount === 1 ? "" : "s"} shown
            </span>
          </div>
          <div
            className="activity-scroll"
            tabIndex={0}
            aria-label="Study activity calendar, scroll horizontally for earlier days"
          >
            <div
              className="activity-calendar"
              role="group"
              aria-label="Saved study days"
              aria-describedby="activity-inspection-hint"
              style={{ gridTemplateColumns: `repeat(${weeks}, 12px)` }}
            >
              {days.map(({ day, month }, i) => (
                <span
                  key={day}
                  className="activity-month"
                  aria-hidden="true"
                  style={{ gridColumn: Math.floor(i / 7) + 1, gridRow: 1 }}
                >
                  {i % 7 === 0 && (i === 0 || month !== days[i - 7].month)
                    ? month
                    : ""}
                </span>
              ))}
              {days.map(({ day, future }, i) =>
                future ? (
                  <span
                    key={day}
                    className="activity-day is-future"
                    aria-hidden="true"
                    style={{
                      gridColumn: Math.floor(i / 7) + 1,
                      gridRow: (i % 7) + 2,
                    }}
                  />
                ) : (
                  <button
                    key={day}
                    type="button"
                    ref={(button) => {
                      if (button) dayButtons.current.set(day, button);
                      else dayButtons.current.delete(day);
                    }}
                    tabIndex={day === inspectedDay ? 0 : -1}
                    aria-label={`${day}: ${saved.has(day) ? "saved study activity" : "no saved study activity"}`}
                    aria-pressed={day === inspectedDay}
                    title={`${day} · ${saved.has(day) ? "Saved study activity" : "No saved study activity"}`}
                    onFocus={() => setSelectedDay(day)}
                    onClick={() => setSelectedDay(day)}
                    onKeyDown={(event) => {
                      if (inspectFromKey(event.key, i)) event.preventDefault();
                    }}
                    className={`activity-day${saved.has(day) ? " has-activity" : ""}${day === dashboard.localToday ? " is-today" : ""}`}
                    style={{
                      gridColumn: Math.floor(i / 7) + 1,
                      gridRow: (i % 7) + 2,
                    }}
                  />
                ),
              )}
            </div>
          </div>
          <p className="activity-day-detail" aria-live="polite">
            {inspectedDay} ·{" "}
            {saved.has(inspectedDay)
              ? "Saved study activity"
              : "No saved study activity"}
          </p>
          <p className="activity-keyboard-hint" id="activity-inspection-hint">
            Select a day to inspect it. Use arrow keys to move between days and
            weeks.
          </p>
          <div className="activity-footer">
            <span>Local calendar days · {dashboard.localToday}</span>
            <span className="activity-legend">
              <i /> No activity <i className="has-activity" /> Saved activity
            </span>
          </div>
          <p className="activity-message">
            {!dashboard.activityDays.length
              ? "No saved study activity yet. Save a reading update, write a note, take a check, or record focus time to begin."
              : studiedToday
                ? "Today's activity is saved."
                : dashboard.streakDays > 0
                  ? "Your streak includes yesterday. Save study activity today to continue it."
                  : "Save study activity today to begin a new streak."}
          </p>
          <p className="activity-policy">
            Days count saved reading progress, changed nonempty notes, quiz
            attempts, and confirmed focus time. Repeated saves, empty notes, and
            excluded timer gaps add no activity. Activity does not imply
            mastery.
          </p>
        </>
      )}
    </section>
  );
}
