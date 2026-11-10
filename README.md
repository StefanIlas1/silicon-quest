# Silicon Quest

A local-first learning companion for a 15–18 month performance engineering roadmap across C++, CPUs, CUDA GPUs and FPGA systems. Read your own PDFs with saved page positions and labeled bookmarks, keep topic notes, and take curated knowledge checks. The curriculum follows [ROADMAP.md](ROADMAP.md): nine selective-study books, seven phases and four portfolio projects, including one integrated PYNQ-Z2 capstone.

The interface groups roadmap topics into **provisional modules**, not verified textbook chapters. Progress tracking and quiz mastery are separate: marking reading complete is not evidence of implementation, and a quiz pass is not a completed portfolio milestone. Course prices and hardware/tool compatibility are historical planning assumptions to verify with official sources before purchase.

## Run locally

Requires Node.js/npm. The desktop application additionally requires Rust and platform-specific Tauri prerequisites.

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

See [TESTING.md](TESTING.md) for the verification scope and [ARCHITECTURE.md](ARCHITECTURE.md) for storage and curriculum boundaries. The [baseline native smoke-test record](src-tauri/SMOKE_TEST.md) documents verified core desktop workflows. Its original feature limits describe that earlier build; persisted reader pages/bookmarks were added afterward and are covered by the reader tests. Follow-up native observations are recorded separately when available.

## Curriculum and privacy

`curriculum/source-roadmap.md` preserves the provided roadmap. `curriculum/build_seed.py` generates the structured curriculum and its public subset. Run it after authoring a seed change:

```sh
python3 curriculum/build_seed.py
```

`curriculum/data.json` includes backend quiz answer keys. UI code imports `curriculum/data.ts`, which uses `public-data.json` without answers or explanations; the desktop backend returns explanations after grading.

Desktop page positions and bookmarks are stored against the exact imported PDF. Reimporting the current PDF preserves them; replacing it with different bytes starts a fresh reading position and bookmark list. Browser preview keeps PDFs and bookmarks in memory for the current session only.

Import only PDFs you have permission to use. Books, notes, quiz history and progress belong in local application storage. PDFs, SQLite files, backups, environment files and local personal folders are ignored by Git. Never add a local study database or licensed textbook to the repository.

No benchmarks are claimed by this application. Portfolio performance improvements require correctness tests, controlled baselines, reproducible measurements and retained evidence.

## CI and license

GitHub Actions checks curriculum regeneration/integrity, TypeScript, frontend integration tests, the production UI build and headless Rust storage tests. It does not build or exercise a desktop application bundle; desktop verification remains required on the target platform.

Application source is available under the [MIT License](LICENSE). That license does not grant rights to imported textbooks, third-party course material or linked resources.
