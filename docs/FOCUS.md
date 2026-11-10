# Focus tracking

Focus sessions track manually started study time against a roadmap topic. They are a personal activity log, not evidence of attention, project completion or quiz mastery. Timer actions award no XP and do not change reading or mastery status.

## Saved time and recovery

The Rust backend owns elapsed-time accounting. The interface may display a live estimate, but dashboard totals and history use confirmed, persisted time. Checkpoints are stored locally in SQLite; changing the system clock cannot create study credit. The summary reports all-time duration, per-topic totals and a clearly labeled UTC-today total. Each accepted interval is assigned to its checkpoint’s UTC date, rather than split across midnight. Recent history is limited to 100 sessions; lifetime totals are calculated from all stored sessions.

A running app uses a monotonic clock. Intervals over 30 seconds, backwards clocks and significant wall/monotonic clock disagreement are excluded rather than counted as continuous study. Closing or crashing the app does not credit offline time. A new owner marks an unfinished session interrupted at its last durable checkpoint. Start a new session when returning to study.

One application process controls focus tracking at a time through an operating-system file lock. Another instance can read the saved log but cannot start, tick or finish the owning process's timer. Quiz, note and reader storage remain independent of timer control.

## Commands and retries

`get_focus_summary`, `start_focus_session`, `tick_focus_session` and `end_focus_session` return an authoritative summary. Start requests include a unique request ID; timer updates include a session ID and sequence number. Retries must reuse the same identifiers so a delayed response cannot create duplicate sessions or double-count elapsed time. The client does not supply credited duration.

A session records its topic, state, saved elapsed seconds, sequence and timestamps. Interrupted rows are labeled in history, and the active-session view reports excluded gaps. Excluded intervals contribute no saved duration. Saved data stays in the local application database alongside the rest of the learning workspace.

## Verification

Use temporary/in-memory databases for automated checks. Cover repeated starts and updates, duplicate/stale sequences, finish retries, concurrent-process ownership, monotonic time, interrupted recovery, excluded gaps, UTC rollups, totals beyond the history limit and unchanged XP/mastery. UI tests should cover starting from a topic, global finish controls, saved versus estimated duration, read-only instances, interrupted states, summary refresh and error recovery.

Focus-session behavior has no native UI smoke-test claim in the reader smoke record. Type checking, production builds and automated tests verify their stated boundaries; run an isolated desktop check before relying on new native interactions.

The focus increment passed 25 headless Rust tests, 19 frontend integration tests, TypeScript checking, the production UI build, Rust formatting and curriculum validation before publication. Backend desktop-feature tests were also run by the backend implementer. No native focus-session UI smoke test was performed; the historical reader smoke record makes no such claim.
