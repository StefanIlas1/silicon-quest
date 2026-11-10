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

Limits: this smoke test exercised a one-page PDF, not a large book. Page position, highlights and bookmarks are intentionally not implemented. A successful one-question knowledge check is a learning signal, not evidence of project implementation. Frontend refinements made after this smoke bundle (draft handling, lazy loading, import cleanup) are covered separately by frontend build/tests; a final bundle rebuild is appropriate before delivery.
