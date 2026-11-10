# Local desktop foundation

Tauri 2 hosts the React app. The Rust process owns SQLite; the webview never receives filesystem access, SQL execution, or an arbitrary URL fetch command. The app has no server, telemetry, remote model, cloud sync, or network plugin.

SQLite lives at Tauri's app data directory (`~/Library/Application Support/com.siliconquest.desktop/silicon-quest.sqlite3` on macOS). The directory is private (0700), and database permissions are 0600 on Unix. PDF imports are stored in the same database as BLOBs, not external file paths. Back up the app data directory while the app is closed; WAL sidecars may exist while it is running. This is local persistence, not encrypted storage.

Schema migrations are embedded SQL under `migrations/`, applied transactionally via `PRAGMA user_version`. Reopening seeds stable book/topic metadata without resetting user data. The authoritative bundled quiz key is `curriculum/data.json`; the frontend uses the separate answer-free curriculum artifact. A local user can inspect the application bundle; this is a learning companion, not a secure examination system.

## Commands

Tauri invoke arguments use camelCase. Errors are `{code,message}` with no raw database paths or SQL.

| Command | Arguments | Result |
|---|---|---|
| `get_dashboard` | none | Dashboard |
| `set_topic_status` | `{topicId,status}` | Dashboard |
| `save_note` | `{topicId,body}` | Dashboard |
| `get_quiz` | `{topicId}` | `{topicId,questions:[{id,prompt,options}]}` |
| `submit_quiz` | `{topicId,answers:number[],attemptId}` | `{attempt,feedback,dashboard}` |
| `import_book_pdf` | `{bookId,fileName,bytes:number[]}` | `{bookId,fileName,importedAt,documentRevision}` |
| `get_book_document` | `{bookId}` | document metadata or null |
| `get_book_pdf` | `{bookId,documentRevision?}` | PDF bytes as number array; an expected revision rejects replaced PDFs |
| `get_book_reader_state` | `{bookId}` | `{page,documentRevision,bookmarks}` |
| `set_book_page` | `{bookId,page,documentRevision}` | null |
| `add_bookmark` | `{bookId,page,label,documentRevision}` | current reader state |
| `remove_bookmark` | `{bookId,bookmarkId,documentRevision}` | current reader state |

Dashboard fields: `topics`, `totalXp`, `level`, `achievements`, `attempts` (latest 100), `notes`, and `streakDays`. Reading status is `not_started`, `reading`, or `read`. Mastery is independently `untested`, `needs_review`, or `passed`.

Marking a topic read earns 20 XP once. Passing its quiz at 80% or higher earns 100 XP once. XP ledger keys are unique per action/topic. Duplicate attempt IDs with identical answers return the original result; conflicting reuse is rejected. Transactions and an immediate lock on quiz award/replay checks protect against simultaneous app instances. The latest graded result controls the current check status; lifetime best scores and already-earned rewards remain after later failures. Spaced recall mastery is tracked separately as described below. Level starts at 1 and increments every 250 XP. Streaks count distinct local calendar days of actual learning actions, with yesterday allowed as the most recent day.

Migration 2 adds a document revision to existing PDFs without changing their bytes or user progress. Reader state defaults to page 1 and no bookmarks. Bookmarks are `{id,page,label,createdAt}`, sorted by page. Page and bookmark writes require the current opaque `documentRevision`; stale writes return `stale_document` and ask the user to reopen the book. Pass this revision when loading PDF bytes as well to prevent a document replacement race.

The backend accepts integer pages from 1 through 100,000; the PDF.js frontend additionally validates the actual page count. Labels are trimmed, single-line, at most 200 Unicode characters; an empty label becomes `Page N`. There is one bookmark per document/page, and adding it again updates its label. Removing a bookmark soft deletes it; adding the page again revives it. Each document allows up to 1,000 active bookmarks. Reader page/bookmark changes do not earn XP or claim mastery.

Importing identical PDF bytes preserves its revision, last page, and bookmarks (the display filename can change). Replacing the bytes creates a fresh revision with page 1 and no visible bookmarks, because page references may no longer match. Previous revision page/bookmark metadata remains in SQLite rather than being erased; it is not shown on the replacement PDF. There is no restore UI for old revisions in this version. Import and revision change are atomic, and all writes are checked under the same transaction as the revision guard.

PDF import accepts up to 100 MiB, requires the `%PDF-` signature, strips directory portions from the display name, and atomically replaces the book's previous import. Signature validation does not guarantee the document is parseable; PDF.js reports document rendering errors in the frontend. Books are supplied by the user and stay local.

## Checks

```sh
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Default features compile the complete Tauri desktop command bindings. `--no-default-features` runs storage tests without linking a webview. Tests use temporary/in-memory databases and never touch real app progress.

For an isolated native smoke test, debug builds honor `SILICON_QUEST_TEST_DATA_DIR=/absolute/temporary/directory`. Release builds ignore this variable and always use platform app data. UI smoke tests must not award test XP in the learner's real database.


## Focus sessions (migration 3)

Rust 1.89 or newer is required for standard-library file locking. Focus ownership uses an exclusive OS lock beside the private SQLite database (`silicon-quest.sqlite3.focus-lock`); the lock is released automatically when its file handle/process closes. A second app instance can read focus history but cannot start, tick or finish sessions. On the next lock-owning startup, unfinished sessions become `interrupted` at their last persisted checkpoint. A non-owning reader never interrupts another live session. Restart a previously non-owning app instance to acquire ownership after the first closes.

All focus commands return `FocusSummary`:

| Command | Arguments |
|---|---|
| `get_focus_summary` | none |
| `start_focus_session` | `{topicId,requestId}` |
| `tick_focus_session` | `{sessionId,sequence}` |
| `end_focus_session` | `{sessionId,sequence}` |

`FocusSummary` is `{activeSession,sessions,totalSeconds,completedSessions,interruptedSessions,todaySeconds,todayDate,topicSeconds,canControl}`. `sessions` contains the latest 100; aggregates use all saved sessions, including the current active checkpoint exactly once. `topicSeconds` contains `{topicId,seconds}`. `todayDate` is a UTC date string. `FocusSession` is `{id,topicId,status,startedAt,endedAt,updatedAt,elapsedSeconds,sequence,excludedGapCount}`; status is `active`, `completed`, or `interrupted`.

The frontend supplies a unique request ID (8-128 letters/digits/hyphens/underscores) when starting. Reusing it for the same topic returns the saved session summary; conflicting reuse is rejected. Only one session can be active. Tick/end requests use the saved `sequence + 1`; duplicates and older sequence replays do not charge time again. Skip-ahead sequences are rejected. The frontend serializes heartbeat/finish requests and retries the same sequence after an uncertain response.

The backend measures elapsed time from its own monotonic clock, never from a client duration. Heartbeats should arrive every 10 seconds. An interval over 30 seconds, a backwards clock, or a wall/monotonic discrepancy over two seconds is excluded in full and increments `excludedGapCount`; the next accepted checkpoint starts from the new anchor. This excludes suspend and long blocked gaps. Focus time is tracked timer time, not proof of attention. It does not award XP, mastery, reading status, achievements or streaks.

Milliseconds are persisted to preserve fractional seconds; display totals floor to seconds after summing. Daily totals attribute each accepted interval to the checkpoint's UTC date (they do not split an interval at midnight). A normal close/crash can lose time since the last saved heartbeat, typically up to 10 seconds. Restarting never infers offline time. Finish explicitly to record the final interval and mark a session completed.

Focus behavior is covered by deterministic Rust tests, including simulated gaps, sleep/clock changes, subsecond/replay handling, lock ownership/recovery and totals beyond the history limit. Native focus UI has not been smoke-tested because GUI automation was unavailable during this increment.


## Spaced review (migration 4, policy version 1)

`get_review_summary()` returns `{asOf,due,upcoming,masteredCount,totalScheduled,evidenceRequired,intervalDays,policyVersion,events}`. Due/upcoming arrays include every scheduled topic; `events` contains the latest 100 review events, while totals use the full schedule. `submit_quiz` now also returns `reviewUpdate` (the immutable effect of that particular attempt) and the current `reviewSummary`, including when an existing attempt ID is replayed. There is no command to award mastery or schedule a topic without an authoritative saved quiz grade.

A scheduled review is `{topicId,stage,successfulReviews,dueAt,intervalDays,lastAttemptAt,lastQualifiedAt,lapseCount,due}`. Stage is `learning`, `needs_review`, or `mastered`. A review event is `{attemptId,topicId,passed,qualified,reason,createdAt,stageAfter,successfulReviewsAfter,dueAtAfter}`. Reasons are `first_pass`, `scheduled_pass`, `early_practice`, and `failed_check`.

This deliberately simple policy is an application heuristic, not a validated retention model:

- First passing check starts at one qualifying success and is due one day later.
- A pass at or after that due time becomes the second qualifying success and schedules three days later.
- The third qualifying pass earns spaced recall mastery and schedules seven days later. The earliest possible mastery is four days after the first pass.
- Later scheduled passes use 14-day then 30-day intervals, capped at 30 days.
- Early passing practice is recorded and graded, but cannot promote a topic or move its due date.
- Any failed check resets the successful-review streak to zero and marks `needs_review`. Its next review is one day later, or an already-sooner future due time. Early repeated failures cannot keep pushing that date away. Passing early after a failure does not erase the scheduled review requirement.
- All days are exact 24-hour intervals based on backend UTC timestamps. Being overdue makes a topic due; it does not itself rewrite its last assessment or mastery stage.

A pass still requires at least 80% correct. The seed currently contains one authored question for each of eight quiz topics; repeated recall of these limited questions is a small signal, not proof of broad understanding, project correctness, or engineering competence. Reading, focus timer duration, and spaced recall evidence remain separate.

The legacy `topic_progress.mastery` / dashboard `mastery` field describes the latest check result (`untested`, `passed`, or `needs_review`), rather than lifetime or spaced mastery. A later failure is visible even after a previous pass. `reviewSummary.masteredCount` and schedule stage provide the repeated-evidence metric. The historical `first-mastery` achievement ID and earned date are preserved with the clearer display title `First Check Passed`; reaching the spaced criterion adds `Spaced Recall` with no XP. Quiz XP remains 100 once per topic regardless of practice, due reviews, retries, or mastery.

Migration 4 transactionally replays all existing saved quiz attempts in parsed timestamp and row-order tie order, including attempts older than the 100-row UI history. It does not rewrite original attempts, dates, best scores, XP, notes, PDF reader state or focus history. Review event timestamps are normalized to UTC. Malformed legacy timestamps stop/roll back the migration instead of fabricating dates. New attempt insertion, XP, check status, review evidence and schedule changes share a single transaction. Duplicate attempt IDs return their original review effect and never advance a schedule twice.

Deterministic tests cover exact due boundaries, early practice, failure resets and due preservation, interval caps, duplicate attempts, cross-connection replay, invalid migration timestamps, full-history migration with 108 original attempts, preservation/reopen, and forced-failure atomic rollback. Native spaced-review UI is not smoke-tested; no GUI automation was used for this increment.

## Local backup and restore (schema revision 5)

Backups are standalone plain SQLite files containing the full workspace, including PDF BLOBs, notes, quiz/review records, reader pages/bookmarks, XP and saved focus checkpoints. They are not encrypted or password-protected. Nothing is uploaded. Export and inspection use native file dialogs inside the Rust process; JavaScript receives no arbitrary file read/write command. The official dialog plugin is initialized for Rust use without adding filesystem or dialog permissions to the renderer capability.

| Command | Result / arguments |
|---|---|
| `export_local_backup()` | Native save dialog; `{fileName,bytes,createdAt}` or null on cancel |
| `inspect_local_backup()` | Native open dialog; `BackupPreview` or null on cancel |
| `discard_backup_preview({previewToken})` | Releases that private staged preview |
| `restore_local_backup({previewToken})` | Explicit replacement; `RestoreReport` |
| `get_backup_status()` | `{restartRequired,workspaceReplaced,safetyBackupPath}`; allowed after restore |
| `restart_after_restore()` | Restarts only when a restored/replaced workspace requires it |

Preview fields: `{previewToken,fileName,createdAt,sourceSchemaVersion,currentSchemaVersion,bytes,counts,interruptedSessions}`. Counts are `{topics,attempts,notes,pdfs,pdfBytes,focusSessions,trackedSeconds,reviewTopics,totalXp,projectMilestones,reviewedMilestones,projectEvidenceNotes,credentialItems,completedCredentials,credentialEvidenceNotes}` after candidate migrations. `createdAt` can be null for a legacy database. `interruptedSessions` counts active source sessions that will become interrupted at their saved checkpoint; it is not the count of already-interrupted history. Previews expire after 15 minutes; choosing a new file invalidates the old token. Discarding a preview removes the private staging directory.

The restore report is `{restored:true,restartRequired:true,safetyBackupFileName,safetyBackupPath,counts}`. A successful token replay returns the identical cached report and does not restore twice, covering a lost IPC response. Status/restart remain accessible if UI state is lost, while all normal data commands stay blocked until a process restart.

Export uses SQLite's online backup API to include committed WAL data consistently. It creates and validates a temporary snapshot beside the chosen destination, adds export metadata, converts the snapshot to a standalone DELETE-journal database, syncs it, then atomically publishes it. It never copies only the live main file and never accepts the live database, its aliases, or working sidecars as destinations. Existing destinations are selected through the operating system's save workflow.

Inspection copies the selected standalone file into a private staging directory before validation or migration. Later changes to the selected source cannot change the prepared candidate. Validation requires:

- Supported schema revisions 1–7, correct application identity for revision 5 and newer, and an exact full SQLite schema match, including expected autoindexes.
- No triggers or views, regardless of their names; unexpected tables, indexes and changed definitions are rejected before application code can seed/migrate the candidate.
- SQLite integrity and foreign-key checks, supported current book/topic IDs, valid PDF signatures/size limits and bounded note/history sizes.
- At most 2 GiB per backup and one million rows in each quiz, focus, review-event or project-action history table. Imported PDFs remain limited to 100 MiB each and notes to 100,000 bytes.

Newer or modified database schemas require compatible software; extra custom tables/indexes are not merged. Unknown future curriculum IDs are rejected by this version. Legacy candidates migrate only inside staging, preserving the original selected file. Only exported standalone backups should be selected: the live database/aliases and files with nonempty adjacent WAL/journal files are rejected. Validation checks structure and consistency; it does not cryptographically authenticate the file or prove the accuracy of edited learning records.

Before replacement, restore requires focus ownership and an exclusive OS writer gate. Normal mutations and startup seeds/migrations hold shared gates, so a new instance or accepted write cannot slip between the safety capture and restore. A private safety snapshot is retained at `recovery/before-restore-<opaque-id>.sqlite3` beside the app database. Its full local path appears in the report (and in an error if copying fails after capture). Recovery files remain until the user manages them; no automatic deletion is claimed.

The candidate gets a fresh workspace epoch before SQLite copies it into the existing live database. The live file is not renamed or swapped; SQLite manages its transactional destination and WAL. An unfinished copy rolls back. Every mutation checks its cached epoch after acquiring its SQLite write transaction. Existing app instances therefore reject stale writes after commit, even when restoring a backup from the exact same epoch. The initiating process immediately fences all normal data commands until restart, including queued PDF/quiz/focus actions. Other instances must restart as well. Close older app versions or external database-editing tools before restoring; those tools do not participate in this application's gate protocol.

Saved active focus sessions become interrupted without adding offline time. Unsaved notes/UI drafts and time since the last heartbeat are not in the snapshot. The frontend requires explicit replacement and unsaved-draft acknowledgement and does not refresh old workspace state after a restore succeeds.

Tests use isolated temporary databases and cover WAL-inclusive full-data round trips, exact-current-epoch restoration with a second open connection, old and newly opened writer fencing, safety-copy timing, forced partial-copy rollback and retry, source changes after inspection, expired/replaced previews, legacy migration (revisions 1–7), unsupported/corrupt/foreign-key-invalid files, invalid PDFs, hot journals, oversized files and malicious trigger/view names. Native file-picker/restart UI has been compiled but has not been manually smoke-tested; no GUI automation was used in this increment.


## Project task and evidence tracking (schema revision 6)

The four roadmap plans contain 35 authored milestones and 75 child tasks. Required counts are 5, 8, 6 and 12 respectively; four additional milestones are optional. Every project has a required portfolio exit review. All task checks start false and all progress/evidence/review fields start empty. Seeding never reads Git or marks work complete from repository activity. The single FPGA capstone remains one project; optional precision/weight-buffer/double-buffer work is not required for its baseline completion.

| Command | Arguments |
|---|---|
| `get_project_summary` | none |
| `save_project_milestone` | `{milestoneId,taskChecks:[{taskId,done}],evidenceNote,status,expectedVersion,requestId}` |
| `review_project_milestone` | `{milestoneId,reviewNote,confirmReviewed:true,expectedVersion,requestId}` |
| `reopen_project_milestone` | `{milestoneId,reason,expectedVersion,requestId}` |

Draft status is `not_started`, `in_progress` or `ready_for_review`. The review command alone can set `completed`, meaning explicitly self-reviewed, never externally verified. Each save must contain exactly one check for every child task. A `not_started` record has no checked tasks or evidence. Review readiness requires all task checks and at least 20 characters of concrete evidence. Explicit review then requires a separate rationale of at least 20 characters and acknowledgement that the user checked the evidence against the definition of done. Evidence is capped at 20,000 bytes; review/reopen notes at 10,000 bytes. Reopen reasons require at least 10 characters. Text references to local reports, commands or URLs stay notes; the backend does not fetch them, execute commands or prove the reported results.

Readiness, checking tasks and saving notes earn no XP. A milestone's first explicit self-review earns 50 XP once through a unique ledger key. Tasks and project totals add no separate reward. Reopening, editing evidence/checks, repeat reviews and request retries cannot farm XP. Historical XP remains after honest reopening, while current reviewed state is cleared.

Every mutation uses the expected version and a unique 8–128-character request ID. Stale versions reject rather than overwrite another draft. Same-ID/same-payload replay returns the current summary and original reward effect with `replayed:true`; conflicting reuse rejects. The frontend must retain the exact pending payload/ID when retrying. Mutators return `{summary,dashboard,milestoneId,xpAwarded,replayed}` so XP and project state can refresh from the same accepted action.

`ProjectSummary` contains `{projects,milestones,totalRequiredMilestones,completedRequiredMilestones,totalXpEarned,history}`. Per-project counts separate required and optional work. Milestone state is `{milestoneId,status,taskChecks,evidenceNote,reviewNote,reviewedAt,updatedAt,version}`. History is limited to the latest 100 actions, while counts/XP use all records. Each action includes its immutable state and authored definition snapshot, rationale/reopen reason, time, request ID and reward effect. Action kinds are `saved`, `reviewed`, `reopened`, and automatic `invalidated`.

Project completion requires every required milestone, including its final portfolio exit review. That final review cannot be completed while required work is unfinished. Editing/reopening a reviewed required milestone invalidates an already-completed exit review, so completing the upstream work again cannot silently re-certify the portfolio. Optional work does not block or invalidate required exit review.

Catalog changes are guarded too: any changed definition bumps its version and downgrades review readiness; untouched work stays `not_started`. Changed required criteria, newly added required work, or optional work becoming required invalidate prior completed exit review. Task/milestone IDs cannot move between parents. Unsupported task/milestone removal rejects transactionally rather than deleting evidence or leaving stale invisible checks; such catalog changes need a dedicated migration. Saved evidence, history and first-earned rewards remain.

Schema revision 6 adds the project tables and extends backup validation/reference schemas/counts. Legacy backups from revisions 1–5 migrate in private staging and receive empty project state; no progress is inferred. Project task/evidence/review history and XP round-trip in backup/restore. Restore validation checks project identities/task ownership, note/history size bounds, coherent review-ready/completed records and matching explicit-review snapshots. Project mutations use the same shared writer gate, in-transaction epoch validation and post-restore restart fence as other learning writes.

Tests cover pristine defaults, task/evidence/acknowledgement gates, version and request collisions, one-time rewards after reopening, exit dependencies/invalidation, optional work, concurrent review attempts, forced audit-write rollback, catalog changes/removal rejection, persistence and project evidence backup/restore. No GUI automation or normal learner database was used. A self-review is a user-authored progress record; correctness tests, hardware evidence and reproducible measurements still have to exist outside this tracker.


## Personal course and certification tracking (schema revision 7)

The tracker stores only the four credential groups authored in the roadmap. Stable categories distinguish NVIDIA DLI's course Certificate of Competency (`course_certificate`), the Coursera specialization completion certificate (`specialization_certificate`), the optional NVIDIA formal certification exam (`formal_certification`), and optional additional CUDA/Nsight study (`optional_coursework`). No exam domains, question banks, issuer credentials, enrollment, purchases or external verification are generated. High priority is a planning preference, not a required purchase or project prerequisite. Historical budget notes still require checking official availability and current prices.

`get_credential_summary()` returns `{items,history,totalItems,inProgressCount,completedCount,notPursuingCount}`. Each item is `{credentialId,status,targetDate,evidenceNote,evidenceReference,completedAt,updatedAt,version}`. Initial records are `not_started`, with no date, evidence, reference or completion timestamp. Personal status is `not_started`, `in_progress`, `on_hold`, `completed` or `not_pursuing`; counts use all four current records, not the limited history.

`save_credential_progress({credentialId,status,targetDate,evidenceNote,evidenceReference,confirmCompleted,expectedVersion,requestId})` returns `{summary,credentialId,replayed}`. It uses the same shared writer gate, in-transaction epoch validation, optimistic version check and unique request replay policy as the other trackers. Stale records return `stale_credential_state`; invalid fields use `invalid_credential_input`. A matching replay returns the current summary without applying the action twice. Unknown outcomes must retry the exact same payload and ID.

Target dates are strict valid civil calendar strings `YYYY-MM-DD` (years 0001–9999), including correct leap-day handling. They remain date-only personal goals, with no UTC conversion or invented official exam deadline. Passing a target date does not complete, fail, expire or revoke anything. The app does not infer credential completion from reading, quizzes, focus time, projects or repository activity.

A `completed` status requires at least 20 characters of saved evidence notes and an explicit self-report acknowledgement. It records what the user reports, not an independently verified award. `completedAt` is the backend UTC time of that self-report, not an issuer's award date. Editing an already-completed report preserves its original self-report time while updating `updatedAt`; moving away from completed clears current `completedAt`, retaining the earlier report in history. Additional optional coursework uses the same personal study status and must not be presented as a formal certification.

Evidence notes are bounded to 20,000 bytes, and an optional single-line reference to 2,048 bytes. References stay plain text; they are never fetched, executed, uploaded or automatically opened. Referenced certificate files are not copied into the database or backup merely because a path was written in this field. The existing imported book PDFs remain separate assets. Personal credential tracking awards no XP, achievements, streaks or mastery.

History contains the latest 100 `{requestId,credentialId,action,createdAt,snapshot,definition}` records with full personal-state and authored-definition snapshots. User saves and catalog-label updates are distinct (`saved` versus `catalog_updated`). Catalog changes bump the record version to reject stale views while preserving the user's personal completion report; a description correction does not revoke a certificate or claim a new one. Stable IDs/categories remain fixed; unsupported identity changes require a migration.

Schema revision 7 adds credential definitions/progress/history and extends backup compatibility through revisions 1–7. Legacy backups receive four empty personal records; migration never invents completion. Backup preview counts add `credentialItems`, `completedCredentials`, and `credentialEvidenceNotes`. Candidate validation checks exact categories/IDs, date and evidence bounds, self-report timestamps and matching acknowledged history. Evidence, references, targets and history round-trip with existing workspace data. All post-restore fences apply to the new mutation.

Tests cover pristine taxonomy, calendar/leap dates, explicit completion/evidence/acknowledgement, no XP or cross-tracker completion, replay/version/input failures, persistence/catalog labeling, forced audit rollback and concurrent edits, full backup/restore plus stale-writer fencing, and malformed restored records/classification. Tests use temporary/in-memory data only. Native commands are compiled; no GUI automation or ordinary learner database was used.
