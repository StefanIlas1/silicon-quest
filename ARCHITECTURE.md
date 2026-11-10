# Architecture

Silicon Quest uses React/TypeScript for its interface and Tauri/Rust for the desktop boundary. SQLite stores progress, notes, quiz attempts, XP events, achievements and imported PDF data locally. The Tauri application creates its database under the platform application-data directory, outside the source tree.

## Curriculum boundary

The provided roadmap is the source of truth. `curriculum/build_seed.py` authors stable IDs and derives two JSON artifacts:

- `data.json`: complete curriculum plus answer keys and explanations, embedded by the Rust store.
- `public-data.json`: curriculum and public questions with answer keys/explanations removed, imported by `data.ts` for the interface.

There are nine books, seven roadmap phases, four portfolio projects and four credential groups. Topic modules are explicitly provisional groupings. They assert neither exact textbook chapter numbering nor a verified table of contents. One runtime-design topic has no book assignment because its source is the roadmap itself.

The source roadmap discusses unverified prices, board support and tool versions. They remain labeled planning assumptions in the seed; the application does not turn them into live recommendations.

## Local persistence and grading

Tauri commands expose dashboard reads, topic-status changes, note updates, quiz retrieval/submission and local PDF import/read. SQLite migrations version the schema. The backend validates stable topic/book IDs and quiz answers, grades against the bundled key, and persists results. Quiz mastery and self-reported topic status remain distinct fields.

XP is an event ledger rather than a mutable client total. Quiz attempt identifiers support safe retries, and unique award keys prevent repeat passing attempts from farming the same reward. Changes that span attempts, mastery and XP use a transaction. UI progress always needs to be reloaded from the authoritative store after mutation.

PDF import records the local document against a known book. Text extraction or automatic chapter mapping must not silently replace the provisional curriculum; future mappings need explicit evidence and user review. There is no cloud account or remote sync architecture in this version.

## Publication boundary

Only source, curriculum, lockfiles and documentation belong in Git. `.gitignore` excludes personal material, database files, PDFs, secrets and generated output. Before any push, inspect the staged files, run required checks and confirm no private study data has entered the index.
