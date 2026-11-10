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

For the persisted-reader change, local verification passed TypeScript, 12 frontend integration tests, the production UI build, 17 headless Rust tests, Rust formatting and curriculum validation. Reader tests cover restored positions without an initial-page overwrite, serialized saves, acknowledged save errors/retry, bookmarks, same-PDF preservation, replacement isolation and temporary browser behavior. The original native smoke record predates this change; do not interpret its historical feature limits as the current feature list or as proof that every new reader scenario was exercised natively.
