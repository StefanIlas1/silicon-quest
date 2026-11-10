# Native smoke test - 2026-11-10

Built `npm run tauri build -- --debug --bundles app` on Apple Silicon macOS with Rust 1.92.0, Node 20.19.5, Tauri 2.12.5 and SQLite bundled through rusqlite 0.34.0. App bundle: `src-tauri/target/debug/bundle/macos/Silicon Quest.app` (build outputs are ignored).

Used `SILICON_QUEST_TEST_DATA_DIR=/private/tmp/silicon-quest-native-smoke` so the learner's real progress stayed pristine. Verified the following through the native macOS application UI at `tauri://localhost`:

- Initial dashboard showed local database connected, 0 XP, 0/8 passed checks, and no streak.
- Start learning opened Caches & locality in the CS:APP reader.
- Marking Read earned 20 XP; saving a topic note displayed its saved confirmation.
- Knowledge check fetched a question without an answer key, accepted the selected answer, graded it, displayed the explanation, and awarded 100 XP for the first pass.
- Imported an original 663-byte one-page PDF fixture with the native file picker. PDF.js worker rendered the title and body clearly. No personal PDFs were used.
- Quit the app, moved the source PDF away, and restarted the bundle with the same isolated database.
- Dashboard still showed 120 XP, 1/8 mastered, and a one-day streak. The reader reloaded the copied PDF, note, reading status, and passed state without the source file.
- Passed a second quiz attempt; XP remained 120 and the UI stated the attempt was saved without another reward.
- Quit the test app. All development commands started for the test were stopped.

Read-only SQLite verification after quitting found 120 XP / 2 attempts / 1 note / 1 PDF in the isolated database; the normal application database remained at 0 XP / 0 attempts / 0 notes / 0 PDFs. Directory permissions were 0700 and database permissions 0600.

Automated verification: 10 Rust tests pass both with default desktop bindings and `--no-default-features`; formatting check passes. Tests cover migrations/reopen, read/mastery separation, invalid submissions, note/PDF persistence, answer-key redaction, streaks, duplicate XP, attempt collisions, and concurrent duplicate attempts across two connections.

Historical baseline limits: this initial smoke test exercised a one-page PDF, not a large book. The initial version did not implement page position, highlights or bookmarks; Phase B below adds page position and bookmarks. A successful one-question knowledge check is a learning signal, not evidence of project implementation. Frontend refinements made after this smoke bundle (draft handling, lazy loading, import cleanup) are covered separately by frontend build/tests; a final bundle rebuild is appropriate before delivery.


## Phase B reader state - 2026-11-10

Rebuilt the debug macOS app after the reader-state UI/backend changes and used the same isolated test database. Its version-1 data migrated without losing its 120 XP, saved note, mastery, or imported PDF. The normal learner database was never opened by this phase.

Verified through native UI:

- Imported an original three-page PDF fixture and rendered page 3 clearly.
- Saved page 3 and a labeled page-linked bookmark; the toolbar showed “Page saved locally” and one bookmark.
- Reimported identical PDF bytes; page 3 and the bookmark remained.
- Quit and restarted the isolated app; reopening the book restored page 3 and its bookmark.
- Used Previous page, then the saved bookmark to jump back to page 3.
- Updated the bookmark label, removed the bookmark, and saved the page again.

The final different-PDF replacement was selected and committed: a read-only SQLite query confirmed that the new 663-byte document/revision was current and the prior revision's page/bookmark metadata was retained separately. Native visual confirmation of its page-1/empty-bookmark view remains unverified because CUA accessibility and screenshot calls timed out. Automated backend and frontend tests cover the fresh-state replacement behavior. Investigation was stopped at the requested boundary; the isolated app process was interrupted and exited with status 130.

Automated Phase B checks passed: 17 Rust tests with desktop and headless features, formatting, frontend build, and 12 UI tests. The bookmark label-prefill refinement was made after this smoke bundle; it passed frontend checks and tests but was not repeated in native UI. No focus-session UI has been tested by this record.
