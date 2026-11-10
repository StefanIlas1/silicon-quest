# Personal course and credential plans

The tracker contains exactly the roadmap's four plans. It does not issue credentials, enroll in courses, register for exams, make payments, cancel subscriptions or verify an issuer's records.

| Plan | Roadmap category | Planning priority |
|---|---|---|
| NVIDIA DLI Modern CUDA C/C++ fundamentals | Course Certificate of Competency, subject to assessment requirements | High |
| Colorado Boulder FPGA specialization | Specialization completion certificate; not an AMD professional certificate | High |
| NVIDIA AI Infrastructure and Operations Associate | Formal certification exam credential | Optional |
| Additional CUDA/Nsight modules | Selected optional coursework, not one professional certification | Optional |

High priority describes the learning plan, not a mandatory purchase or a prerequisite for project completion. All plans can be put on hold or marked not pursuing. The optional modules are a group: name the modules actually pursued/completed in your notes. The app adds no exam domains, certification questions or new programs.

## Your report, not an issuer decision

Personal statuses are `not_started`, `in_progress`, `on_hold`, `completed` and `not_pursuing`. Completion is explicitly labeled **self-reported**. It requires at least 20 characters of saved evidence and an acknowledgement tied to the exact draft. A completed plan earns no XP or mastery and does not complete a project or knowledge check.

`completedAt` is the backend UTC time when the current completion report was first recorded, not an official award date. Editing an already-completed record retains that report timestamp; moving out of completed clears the current timestamp, while history remains. A later completion report receives a new timestamp. Put any actual issuer date/outcome in your evidence notes rather than treating the app timestamp as the award date.

Target dates are optional personal `YYYY-MM-DD` calendar dates. They are not registration, exam windows or vendor deadlines. Passing a target date does not change status or create a completion. The interface preserves the chosen calendar date rather than converting UTC midnight into the previous local day.

Evidence notes and references are private text. References are not fetched, opened or copied as attachments, and no reference is presented as externally verified. App backups preserve the text, not the external certificate file or page it refers to.

## Versions, drafts and history

Drafts survive in-app navigation but remain unsaved until confirmed by the backend. Version conflicts preserve them for comparison instead of overwriting newer saved records. Uncertain replies are retried with the same request ID and payload; replay cannot duplicate history. A newer returned record does not silently rebind an old draft to a new version.

History keeps prior personal reports and the plan definition used at each action. Clearing current evidence does not erase earlier snapshots or old backup copies. Plan metadata updates advance versions and record `catalog_updated` while preserving personal reports; a changed price or description is not an issuer revocation. Stable plan identities/categories are enforced.

Schema 7 adds persisted credential state/history and extends private backup/restore. Older supported backups gain four unstarted plans, with no invented dates or evidence. Saved reports/history are included in plaintext backups; unsaved course drafts are excluded and discarded on restore/restart. The restore boundary unmounts this provider, and credential writes obey the same gates and epoch fences as other learning data.

## Source and verification limits

Titles, provider references, intended timing and budget notes come from the roadmap. Prices and availability remain historical planning assumptions, not checked live checkout offers. Verify the official provider's current requirements before purchasing or claiming an actual credential. The app does not automatically contact a provider.

Automated checks should cover the four classifications, untouched initial state, real calendar dates/leap days, explicit completion, no XP/mastery effects, version/replay conflicts, preserved snapshots, metadata updates and backup/restore fencing. No native credential-tracking GUI smoke test is claimed; the reader smoke record describes its own earlier scope.

Before publication, independent checks passed 69 headless Rust tests, 67 frontend tests, TypeScript, the production UI build, Rust formatting and curriculum validation. The backend owner also confirmed 69 desktop-feature tests. Fixtures cover dates, explicit reports, unchanged rewards, concurrency, snapshots and schema7 backup/restore; no normal learner data or native GUI was used.
