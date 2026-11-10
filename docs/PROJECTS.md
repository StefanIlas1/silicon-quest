# Roadmap project evidence

The app tracks the roadmap's four portfolio projects. The seed defines 35 milestones and 75 child tasks; it contains no earned progress, benchmark results, artifact contents or completed checkboxes. Definitions are roadmap-derived checklists, not new textbook chapters or additional portfolio projects.

| Project | Required milestones, including exit review | Scope notes |
|---|---:|---|
| Low-Latency Matching Engine | 5 | Modify-order support only if included in the chosen engine contract |
| CUDA KernelForge | 8 | One convolution or related compute-heavy kernel is required; it is not several unrelated projects |
| GPU Inference Runtime | 6 | Supported precision/accuracy experiment |
| PYNQ Quantized Accelerator | 12 | INT4, runtime-loaded weights and double buffering, when supported/justified |

The FPGA plan is one integrated capstone. Its early RTL, fixed-point, synthesis, FIR, overlay and DMA exercises are milestones within that project. The proposed small gesture-network shape is illustrative; physical deployment and resource/timing evidence must establish the actual fit. Optional FPGA stretches do not gate baseline completion.

## Record work, then self-review

Each milestone shows its source section, definition of done, evidence hints and child tasks. Check tasks only after doing the work. Save evidence notes containing concrete references such as test commands/results, raw measurement locations, profiler/timing reports or a physical-demo record. Reading, quiz results, focus duration, Git activity and the app's own test suite never complete learner project tasks automatically.

Milestone states are `not_started`, `in_progress`, `ready_for_review` and `completed`. Ready-for-review requires every child task checked and at least 20 characters of saved evidence. Completion additionally requires an explicit acknowledgement and a self-review rationale of at least 20 characters. These checks validate the record, not the truth of its contents. The interface labels completion as self-reviewed evidence; the app does not run, fetch or independently verify referenced artifacts or performance claims.

The first completed self-review earns 50 XP per milestone. Reopening, editing, reviewing again or replaying a request cannot earn that reward twice. Previously earned XP remains when current completion is reopened. XP records an app action, not independently measured engineering competence.

## Whole-project exit review

Every project has one required portfolio exit review covering its complete roadmap definition of done. The backend rejects its completion until all other required milestones are self-reviewed. All required milestones, including that exit review, must currently be completed for the project to be shown completed. Optional work is counted separately.

Changing or reopening a completed required work milestone reopens the completed exit review. Completing that work again does not silently complete the exit review; review the full project again. Changes to optional work do not invalidate baseline completion.

Catalog changes also preserve this boundary: changed definitions advance versions and require the new criteria to be reviewed, and new required work invalidates an old exit review. Unsupported removal/reassignment of stable task or milestone identities is rejected rather than silently dropping records. Original action snapshots retain the definition used at the time.

## Drafts, versions and history

Task, evidence and review drafts stay in memory across in-app navigation. Save before closing or exporting a backup. A mutation includes its expected milestone version and a unique request ID. Retry uncertain outcomes with the same payload/ID. Conflicting edits preserve the local draft and require an explicit decision to reload/reapply; an older request must not silently overwrite newer evidence.

Action history stores immutable snapshots, including prior evidence and definitions. Editing current notes does not erase that history or old backup copies. Summaries use all persisted records; the displayed history is limited to the latest 100 actions. Artifact references remain private text unless the user separately shares them.

Schema 6 persists project plans, definitions, task checks, evidence, review state and history. Backups include these saved records; legacy backups gain the current unstarted project plans during staging migration. Restore fences and the root restore boundary cover project mutations/drafts as well as other learning state.

## Verification boundary

Use isolated test data for save/review/reopen, exact task IDs, optimistic conflicts, idempotent rewards, exit-review invalidation, optional work, catalog changes, audit rollback and backup/restore. Seed validation checks four project plans, globally unique milestone/task IDs, valid references, one required exit review per project and the absence of earned progress in definitions.

No native project-tracking GUI smoke test is claimed. Automated storage/UI checks and production builds verify their stated boundaries; a self-reviewed learner milestone is separate from verification of this application.

Before publication, independent checks passed 61 headless Rust tests, TypeScript, 56 frontend tests, the production UI build, Rust formatting and curriculum validation. The frontend owner rechecked the same 56 tests after the final stale-error cleanup; the backend owner also ran desktop-feature tests. Catalog-change, concurrency, exit invalidation and project backup/restore cases use isolated fixtures. No normal learner data or native GUI was used for this increment.
