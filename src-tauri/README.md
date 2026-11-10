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

Marking a topic read earns 20 XP once. Passing its quiz at 80% or higher earns 100 XP once. XP ledger keys are unique per action/topic. Duplicate attempt IDs with identical answers return the original result; conflicting reuse is rejected. Transactions and an immediate lock on quiz award/replay checks protect against simultaneous app instances. A pass is retained as the best achievement after later review attempts. Level starts at 1 and increments every 250 XP. Streaks count distinct local calendar days of actual learning actions, with yesterday allowed as the most recent day.

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
