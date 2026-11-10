# Architecture

Silicon Quest uses React/TypeScript for its interface and Tauri/Rust for the desktop boundary. SQLite stores progress, notes, quiz attempts, XP events, achievements, imported PDF data, page positions, bookmarks, focus checkpoints and review schedules/events locally. The Tauri application creates its database under the platform application-data directory, outside the source tree.

## Curriculum boundary

The provided roadmap is the source of truth. `curriculum/build_seed.py` authors stable IDs and derives two JSON artifacts:

- `data.json`: complete curriculum plus answer keys and explanations, embedded by the Rust store.
- `public-data.json`: curriculum and public questions with answer keys/explanations removed, imported by `data.ts` for the interface.

There are nine books, seven roadmap phases, four portfolio projects and four credential groups. Topic modules are explicitly provisional groupings. They assert neither exact textbook chapter numbering nor a verified table of contents. One runtime-design topic has no book assignment because its source is the roadmap itself.

The source roadmap discusses unverified prices, board support and tool versions. They remain labeled planning assumptions in the seed; the application does not turn them into live recommendations.

## Local persistence and grading

Tauri commands expose dashboard reads, topic-status changes, note updates, quiz retrieval/submission, local PDF import/read, revision-bound reader state, focus tracking and review summaries. SQLite migrations version the schema. The backend validates stable topic/book IDs and quiz answers, grades against the bundled key, and persists results. Self-reported reading, latest-check results and repeated-review mastery remain separate. The legacy `topic_progress.mastery` field describes the latest check result; review schedule stage and `masteredCount` describe repeated qualifying recall.

XP is an event ledger rather than a mutable client total. Quiz attempt identifiers support safe retries, and unique award keys prevent repeat passing attempts from farming the same reward. Changes that span attempts, mastery and XP use a transaction. UI progress always needs to be reloaded from the authoritative store after mutation.

PDF import records the local document against a known book. Schema migration 2 preserves existing documents/progress and adds opaque document revisions, page positions and labeled page bookmarks. Writes validate the current revision in the same transaction as the mutation, rejecting stale windows after replacement. Reimporting current identical bytes preserves state; different bytes create a fresh revision. Older revision metadata stays in SQLite but has no restore interface. PDF.js checks actual page bounds; the backend also enforces integer bounds. Reader actions award no XP and claim no mastery. Text extraction or automatic chapter mapping must not silently replace the provisional curriculum; future mappings need explicit evidence and user review. There is no cloud account or remote sync architecture in this version.

Migration 3 adds [focus sessions](docs/FOCUS.md): backend monotonic checkpoints, an exclusive process ownership lock and recovery at the last saved checkpoint without offline credit. Timer actions do not change XP, latest-check results or review evidence.

Migration 4 adds [scheduled review](docs/REVIEW.md), replaying all existing grades in chronological order while preserving raw history and earned rewards. New scheduling events, grades, current results and first-pass XP share a transaction. Three qualifying successes are required for repeated-review mastery; early passes remain practice. The interface prevents stale queue requests from replacing a newer quiz-returned summary.

Migration 5 adds application/workspace identity and [backup/restore](docs/BACKUP.md). Native Rust dialogs choose paths; JavaScript supplies only opaque preview tokens. Validation and legacy migration occur in private staging. A shared writer/startup gate and exclusive restore gate span safety capture and atomic same-file replacement. Fresh candidate epochs reject stale writers; a successful restore fences the process until restart. A root boundary unmounts learner state/providers and supports status recovery when a restore response is uncertain. Backups are plain local SQLite files containing PDF BLOBs, with no encryption or cloud-transfer service.

## Publication boundary

Only source, curriculum, lockfiles and documentation belong in Git. `.gitignore` excludes personal material, database files, PDFs, secrets and generated output. Before any push, inspect the staged files, run required checks and confirm no private study data has entered the index.
