# Silicon Quest

A local-first learning companion for a 15–18 month performance engineering roadmap across C++, CPUs, CUDA GPUs and FPGA systems. Scroll through your own PDFs with saved page positions, labeled bookmarks, page notes and text highlights, organize your own chapter index, take curated knowledge checks, revisit a spaced-review queue, and track saved study activity. The curriculum follows [ROADMAP.md](ROADMAP.md): nine selective-study books, seven phases and four portfolio projects, including one integrated PYNQ-Z2 capstone.

The interface groups roadmap topics into **provisional modules**, not verified textbook chapters. Reading status, the latest graded check and repeated-review evidence are separate. Marking reading complete is not evidence of implementation, and a quiz pass is not a completed portfolio milestone. Reading suggestions follow roadmap phase order, including early parallel RTL study. A finished reading log does not complete project milestones. Course prices and hardware/tool compatibility are historical planning assumptions to verify with official sources before purchase.

## Run locally

Requires Node.js/npm. The desktop application additionally requires Rust 1.89 or newer and platform-specific Tauri prerequisites.

```sh
npm install
npm run dev
```

The Vite development URL is printed in the terminal. Browser preview is for interface development; the desktop application's authoritative persistence and grading use Rust/SQLite.

```sh
npm run tauri dev
```

## Verify

```sh
npm run check
npm test
npm run build
cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml
```

See [TESTING.md](TESTING.md) for the verification scope and [ARCHITECTURE.md](ARCHITECTURE.md) for storage and curriculum boundaries. The [native smoke-test record](src-tauri/SMOKE_TEST.md) documents verified core desktop, fullscreen and reader workflows and their limits. PDF replacement fresh-state behavior is covered by automated tests; its final native visual check remains unverified.

## Focus sessions

Start a focus session from a study topic or the Focus log. Finish it when you are done. Saved totals use backend checkpoints; the live clock includes a short unsaved estimate. Closed-app time, long heartbeat gaps and clock discontinuities do not become study credit. Timer actions award no XP or mastery. See [focus tracking](docs/FOCUS.md) for recovery, concurrent-instance behavior and verification boundaries.

## Chapters and reading

Open a book and use **Chapter index → Add chapter** to enter titles from your edition, reading status and chapter notes, before or after importing a PDF. Optional page ranges use the reader's PDF page numbers. Chapter identity and notes survive title/order edits and PDF replacement; page links require the matching PDF revision. Drafts stay available across navigation while the app is open, and Settings warns before backup or restore. Chapter reading is self-reported and awards no XP or mastery. See [manual chapter indexes](docs/CHAPTERS.md) for limits, conflicts and preview behavior.

## Study activity

The overview shows 13, 26 or 52 calendar weeks of saved local activity, with current/longest streaks. A filled day means at least one changed reading update, changed nonempty note, accepted quiz attempt or confirmed focus interval; it does not indicate intensity or mastery. Keyboard users can inspect dates with arrow keys. The timer is manually controlled and does not detect attention or input inactivity. See [saved study activity](docs/ACTIVITY.md) for local-midnight rules, refresh behavior and historical records.

## Review queue

A first graded check starts a persisted review schedule for its curated topic. Early passes are practice; subsequent qualifying passes must wait until the review is due. Three qualifying successes demonstrate spaced recall, while a failure resets the current evidence streak. Historical attempts, best scores and earned XP stay intact. See [scheduled review](docs/REVIEW.md) for intervals, migration and latest-check versus repeated-mastery semantics.

## Project evidence

The four roadmap projects have 35 milestones and 75 child tasks, with optional work separated from required completion. Save concrete evidence, then explicitly self-review against the definition of done; each project also requires a whole-project exit review. This records your review, not independent verification. Reading, timers, quiz passes and Git activity never complete portfolio work automatically. See [project evidence](docs/PROJECTS.md) for scope, versions, history and one-time rewards.

## Courses and credentials

Track the roadmap’s four course/credential plans with personal status, calendar target dates and saved evidence references. Completion is self-reported, not an app-issued or externally verified award, and earns no XP/mastery. Source categories distinguish course certificates, the specialization, the optional formal exam and optional coursework. See [personal credential plans](docs/CREDENTIALS.md) for taxonomy, privacy and history.

## Backups

Settings can export a standalone SQLite backup, including saved PDFs, private cover images, chapter indexes and learning history. Restore first validates a private staged copy, shows its contents and requires explicit replacement confirmation. A safety copy is retained and a full restart follows a successful restore. Backups are not encrypted; save note, chapter, annotation, project and course drafts before exporting. See [local backup and restore](docs/BACKUP.md) for supported files, recovery and verification limits.

## Book and course artwork

Choose a local PNG or JPEG in a book's study workspace or a course tracker. Images are stored in private SQLite storage, work offline and travel with local backups. Resetting a cover returns to the neutral fallback. The application makes no image downloads or remote image requests. Official book covers and course/provider images installed on this Mac remain outside the repository and release resources; source publication does not redistribute them. See [artwork storage and validation](docs/ARTWORK.md), [book provenance](docs/BOOK_ARTWORK.md) and [course provenance](docs/COURSE_ARTWORK.md).

## Curriculum and privacy

`curriculum/source-roadmap.md` preserves the provided roadmap. `curriculum/build_seed.py` generates the structured curriculum and its public subset. Run it after authoring a seed change:

```sh
python3 curriculum/build_seed.py
```

`curriculum/data.json` includes backend quiz answer keys. UI code imports `curriculum/data.ts`, which uses `public-data.json` without answers or explanations; the desktop backend returns explanations after grading.

Desktop page positions, bookmarks and annotations are stored against the exact imported PDF. Scroll naturally between pages or jump using the page field, bookmarks, chapter links or annotations. Use **Bookmark page** for a quick bookmark; open **Bookmarks** to edit labels. Add a page note or select text within one page and choose **Highlight selected text**, then save it. Highlights and notes live alongside the PDF and do not modify its bytes. Scanned pages may have no selectable text; cross-page text highlights are not supported.

Choose **Full screen** to expand the reader, then use **Exit full screen** or **Esc** to return. The desktop app uses native window fullscreen; browser preview uses browser fullscreen when available, with a viewport fallback. The same reader stays mounted, retaining its scroll position and unsaved annotation draft. Saved highlight coordinates scale with their PDF page and remain clipped within it.

Reimporting the current PDF preserves its state; replacing it with different bytes starts fresh reader state and hides the old revision's annotations. Unsaved annotation drafts survive navigation for the app session; save before quitting or restoring a backup. PDF page numbers may differ from printed page numbers. Browser preview keeps PDFs and bookmarks in memory for the current session only and requires the desktop app to save annotations.

Import only PDFs and images you have permission to use. Books, artwork, notes, quiz history and progress belong in local application storage. PDFs, SQLite files, backups, environment files and local personal folders are ignored by Git. Never add a local study database, private cover image or licensed textbook to the repository.

No benchmarks are claimed by this application. Portfolio performance improvements require correctness tests, controlled baselines, reproducible measurements and retained evidence.

## CI and license

GitHub Actions checks curriculum regeneration/integrity, TypeScript, frontend integration tests, the production UI build and headless Rust storage tests. It does not build or exercise a desktop application bundle; desktop verification remains required on the target platform.

Application source is available under the [MIT License](LICENSE). That license does not grant rights to imported textbooks, third-party course material or linked resources.
