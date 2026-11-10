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

## Private book and course artwork - 2026-11-10

Rebuilt the current desktop bundle with `npm run tauri -- build --debug` and
inspected its native macOS UI at `tauri://localhost` using CUA. This artwork
inspection used the normal application database in read-only UI flows after
the requested private cover installation. It did not mark reading, run quizzes,
save notes, change course records, or start focus sessions.

Verified through the native UI:

- All nine actual book covers rendered in the library across its three rows,
  including PMPP fifth edition, quantitative architecture seventh edition, and
  Digital Design's ARM edition. Images kept their proportions within the cards.
- All four course plan cards displayed their installed images, including the
  grouped optional CUDA / Nsight plan. Course labels and self-report controls
  remained visible.
- The dashboard bookshelf displayed its two real covers at the intended compact
  width, without the previous flex-growth issue.
- The optional course's local cover chooser opened a native PNG/JPEG file
  selection sheet. Cancel returned to the course view and preserved its image.
- Quit through the native application menu; a subsequent CUA inventory confirmed
  that Silicon Quest was no longer running.

Read-only SQLite checks before and after the smoke found identical row counts
and content hashes for all 27 non-artwork tables. The database retained nine
book and four course artwork records, and `PRAGMA integrity_check` returned `ok`.
No screenshots or private learner content were saved in repository files.

Limits: this smoke did not replace or reset the user's installed artwork, test
malformed images through the native picker, resize through a narrow-window
sweep, or exercise focus tracking. Image validation, replacement/reset state,
and artwork backup/restore are covered by automated tests. The UI reported that
another process owned focus tracking; those controls were left untouched. The
initial CUA app-launch call took about 261 seconds; subsequent inspection and
cleanup calls completed. This record does not claim that a later source change
was included in the already-built smoke bundle.

## Continuous reading and PDF annotations - 2026-11-10

Built and launched the debug macOS bundle with an explicitly isolated test-data
directory. Imported an original synthetic three-page text PDF through the native
picker; no licensed book or learner notes were used for these reader writes.

Verified through the native UI:

- Wheel-scrolled across page boundaries to page 3 and used the quick bookmark
  action there.
- Saved a page note on page 3, then used Previous page to reach page 2.
- Drag-selected an actual line of selectable PDF text, saved its highlight, and
  inspected the yellow overlay aligned with that line. The annotations count
  showed both saved records.
- Chapter/bookmark/annotation content stayed in the bounded metadata area while
  the reader footer remained visible.
- Quit the isolated app with Command-Q; its process exited successfully.

Read-only inspection of the isolated SQLite database after exit confirmed one
page-3 bookmark, a page-3 note and a page-2 highlight with normalized rectangles.
`PRAGMA integrity_check` returned `ok`. Screenshots were inspected in the tool
without saving them to the repository.

Limits: a later accessibility snapshot selected a different application/profile,
so UI interaction stopped rather than risking writes to an ambiguous instance.
Native restart/persistence, replacement isolation, annotation edit/delete,
scanned pages, cross-page selection, large documents and a narrow-window sweep
were not verified by this smoke. Automated tests cover persistence, replacement,
edit/delete and malformed anchors. Final selection-size validation refinements
after this bundle are covered by automated checks, not this native observation.

## Fullscreen and page-contained annotations - 2026-11-10

Built and launched a separate debug QA bundle with a distinct application
identifier and `SILICON_QUEST_TEST_DATA_DIR=/private/tmp/sq-fullscreen-qa-20261110`.
Used a synthetic PDF and isolated SQLite fixture; learner PDFs, notes and
progress were not used for these writes.

Verified through the native macOS UI:

- Entered fullscreen and returned with Escape and the visible exit control.
- Resized the reader and inspected the saved page-2 highlight in fullscreen
  and at 110% zoom; its yellow rectangles remained aligned within the PDF page.
- Kept an unsaved page-note draft through fullscreen transitions, then saved it.
- Quit and restarted the isolated application; the saved note and highlight
  persisted.
- Quit the QA app after verification. Read-only inspection confirmed that the
  source PDF bytes were unchanged.

Notes and highlights remain private SQLite sidecar records tied to the exact
PDF revision. This smoke does not establish that annotations are embedded in
an exported PDF. Automated tests also cover unchanged PDF bytes, restart and
backup persistence, same-byte reimport preservation and replacement isolation.

Limits: this smoke used a short synthetic PDF on macOS. It did not repeat
different-PDF replacement through the native picker, annotation edit/delete,
scanned/cross-page selection limits, large-book behavior or Windows/Linux
fullscreen. Focus trapping, rejected native operations and delayed/unmount
cleanup were checked automatically, not through assistive technology.

After the QA run, rebuilt the normal debug `Silicon Quest.app` bundle and
verified its identifier was restored to `com.siliconquest.desktop`. This build
was not launched against the learner's data for further writes.
