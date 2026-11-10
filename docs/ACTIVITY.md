# Saved study activity

The overview heatmap reads the existing SQLite `activity_days` ledger. Each
filled square means at least one saved study action on that local calendar day.
It is binary: neither intensity, event counts, elapsed time, mastery nor XP is
inferred from the presence of a day. A fresh profile has no filled squares.

Qualifying actions are changed topic/chapter reading progress (except resetting
to not started), changed nonempty topic/chapter notes, a new accepted quiz
attempt (pass or fail), and positive confirmed focus time. Merely opening the
app, navigating PDF pages, importing a PDF, changing chapter metadata, starting
a timer without confirmed elapsed time, replaying an accepted request, saving
unchanged text, clearing a note, or excluding timer gaps adds no activity.
Qualifying actions and their day insert commit in the same transaction.
Focus is a manually run timer: background checkpoints can count while it remains
running. The app does not detect attention, keyboard/mouse inactivity, or whether
the window is foregrounded. Long gaps, sleep, and invalid clock samples are
excluded according to the focus timer policy.

The store returns `localToday`, `activityDays`, `streakDays`, and
`longestStreakDays` in the dashboard. Current streak counts consecutive dates
ending today, or ending yesterday while today has no recorded activity. Missing
yesterday resets it to zero. Longest streak counts the largest consecutive run
through today. Future days never contribute. Existing saved day records are
preserved, including historical records created by earlier activity policies;
the app does not erase or reinterpret that history.

Focus activity uses the operating system's local timezone at checkpoint time.
Accepted focus checkpoints span at most 30 seconds. An interval crossing local
midnight records both days containing confirmed time, and its end is exclusive:
ending exactly at midnight does not create a day without elapsed time. UTC
instants preserve elapsed-time meaning through daylight-saving transitions.
Focus duration totals in the Focus log retain their existing, explicitly labeled
UTC daily policy. Old UTC `focus_daily` rows are not retroactively converted to
local activity days, since those aggregate rows cannot establish exact local
intervals. New confirmed checkpoints populate local activity from this version.

The UI uses calendar-only date arithmetic for the heatmap, avoiding browser
timezone shifts and 23/25-hour day arithmetic. It refreshes after accepted study
changes and focus checkpoints, when the window gains focus, and every minute
while storage is connected. This includes local date or timezone changes while
the app stays open. Failed refreshes retain the last confirmed history and show
a visible stale-history message; unavailable storage is distinct from a saved
empty history.
Calendar days have visible date/activity details and one roving keyboard tab
stop. Arrow keys move by day vertically and week horizontally; Home/End move to
the first/last available day of a week. Empty cells and the legend have visible
boundaries against the panel, and the scroll area/day buttons have focus rings.

Controlled-clock backend tests cover local midnight, the midnight endpoint,
offsets on both sides of UTC, DST transition instants, empty/old/gapped streaks,
leap days, durable reopen, no-op/blank/reset writes, and excluded/replayed focus
checkpoints. Component tests cover empty and unavailable states, actual saved
days, range selection, calendar boundaries, and preserved data on refresh
failure. No native GUI activity smoke test is claimed here.
