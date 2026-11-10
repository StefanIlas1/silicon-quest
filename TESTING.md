# Verification

Run TypeScript checking and a production build after interface changes:

```sh
npm run check
npm test
npm run build
```

Run backend tests after storage, grading, migrations or reward changes:

```sh
cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml
```

Tests should exercise behavior: persisted progress after reopening the store, invalid input rejection, backend quiz grading, repeat-attempt idempotency, XP anti-farming and mastery independent of reading status. Avoid treating a successful build as proof that a desktop interaction works.

For a desktop release, manually verify a fresh local profile: inspect all nine books and seven phases, open a topic, save a note, change reading status, submit correct/incorrect quiz answers, retry a submission, restart and verify persistence. Import an authorized local multi-page PDF, navigate its pages, wait for the saved-position acknowledgement, add/rename/jump to/remove bookmarks, then restart and reopen it. Confirm the last page and remaining bookmarks persist. Reimport the same bytes to verify preservation; replace with different bytes to verify fresh state and stale-window rejection. Check empty states for books without PDFs and topics without quizzes, and visible error/retry behavior when local operations fail.

For curriculum edits, regenerate the artifacts, validate that IDs and references remain unique/valid, confirm the public artifact has no answer keys or explanations, and compare source facts with `curriculum/source-roadmap.md`. Never mark learning or project milestones complete solely because a seed or test fixture exists.

Before publishing, inspect `git status --short` and staged filenames. PDFs, notes, database/WAL files, backups and credentials must remain local. This document describes required verification; it is not a claim that every check has already run.

The CI workflow runs the store without the desktop feature so Linux runners do not need GUI system libraries. Run `cargo check --manifest-path src-tauri/Cargo.toml` and the actual desktop app on a supported platform to verify the Tauri boundary. CI also regenerates curriculum JSON, rejects artifact drift, and runs `python3 curriculum/validate_seed.py`.

For the persisted-reader change, local verification passed TypeScript, 12 frontend integration tests, the production UI build, 17 headless Rust tests, Rust formatting and curriculum validation. Reader tests cover restored positions without an initial-page overwrite, serialized saves, acknowledged save errors/retry, bookmarks, same-PDF preservation, replacement isolation and temporary browser behavior. The [native smoke record](src-tauri/SMOKE_TEST.md) separates baseline and Phase B reader checks and identifies the unverified final replacement visual check. It does not establish that every reader scenario was exercised natively.

For focus and review changes, use controlled clocks and isolated databases to check boundaries without waiting real days or modifying learner history. Focus tests should cover ownership, restart interruption, duplicate requests, excluded gaps and unchanged XP. Review tests should cover three qualifying successes, early practice, failures, exact due timestamps, chronological backfill beyond 100 attempts, retry safety and rollback. See [focus tracking](docs/FOCUS.md) and [scheduled review](docs/REVIEW.md) for the exact policies and recorded verification. No native focus/review GUI smoke test is claimed; the reader smoke record describes its historical scope.

Backup/restore tests must use isolated fixtures. Verify WAL-consistent full-asset export, every supported legacy schema, exact-schema validation (including wildcard-looking trigger/view names), foreign keys and resource limits, private staging, invalid/expired previews, same-token outcome replay, safety snapshots, forced-copy rollback, stale writer fences and startup/writer exclusion across the capture/replacement window. Mocked UI checks cover confirmation, cancellation, draft/focus boundaries, lost responses, startup status gates, provider teardown and restart failures. See [backup verification](docs/BACKUP.md) for recorded results; native dialogs and full native backup UI remain unverified by GUI smoke testing.

Project tests should verify canonical plans start unearned; exact child-task identities; explicit evidence/self-review; one-time rewards; request/version conflicts; full-project exit gating; catalog-change invalidation; preserved immutable history; and schema6 backup/restore with queued-write fencing. UI tests should preserve drafts through navigation and conflicts, bind acknowledgements to saved versions, handle newer mutation summaries, and warn separately about note/project drafts before backup. No native project GUI smoke test is claimed.

Credential tests must distinguish the four source categories, retain untouched initial plans, validate calendar-only target dates/leap years, require explicit completion evidence, preserve report history and leave XP/mastery/projects unchanged. Check exact request replay, concurrent versions, preserved drafts, draft-bound acknowledgement, report-time wording, category integrity and schema7 backup/restore fences. Native course/credential GUI smoke testing was not performed.

Chapter tests cover schema7 migration, an initially empty manual index, stable identities through title/order edits, independent reading/notes, optimistic conflicts, revision-bound mappings, PDF replacement, unchanged activity on metadata/reset writes, malformed backup identities/timestamps, schema8 backup/restore, private-file permissions and stale workspace fences. UI integration checks retain per-book drafts through navigation and warn about unsaved chapters before backup/restore. See [manual chapters](docs/CHAPTERS.md); no native chapter persistence/dialog smoke test is claimed.

Activity tests use saved dates and controlled clocks rather than fabricated history. Cover empty/unavailable/stale states, no-op/blank/reset writes, accepted versus replayed attempts/checkpoints, local midnight with an exclusive endpoint, offsets/DST instants, leap days, gaps and future dates. UI tests check range selection, arrow-key date inspection, refresh after subsecond focus confirmation and stale-warning recovery after authoritative reading updates. The timer measures manually started elapsed time and does not detect attention or keyboard/mouse inactivity. See [saved activity](docs/ACTIVITY.md).

For the 2026-11-10 activity/chapter/interface increment, final local checks passed 83 frontend tests, 82 headless Rust tests, TypeScript/production UI build, desktop-feature `cargo check`, Rust formatting and curriculum regeneration/integrity checks. Native Chrome visual checks inspected the overview, library, reader, chapter form, activity unavailable state and compact navigation at 200% browser zoom; zoom was restored afterward. The graphite interface uses system fonts/local assets, retains keyboard focus and supports reduced motion. These visual checks do not establish native saved-activity rendering or durable chapter behavior. No learner database, imported book or personal backup was used for automated verification.
