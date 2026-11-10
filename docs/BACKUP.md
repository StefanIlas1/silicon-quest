# Local backup and restore

Settings can export a standalone SQLite copy of saved learning data. It includes imported PDFs, notes, reading/quiz/XP records, reader positions/bookmarks, focus checkpoints, review schedules, project evidence/history and personal course/credential reports. Unsaved note/project/course drafts and the live timer's unconfirmed interval are not included. Save drafts before exporting.

Backups are **not encrypted** and have no password protection. The app performs local file operations without a cloud-transfer service. You choose the destination; an operating-system synced or shared folder may distribute that file independently of Silicon Quest. Treat the copy as private study material, including any licensed PDFs it contains.

## Export

Choose **Export local backup** and select a destination using the native save dialog. Cancellation creates no backup. Success reports the actual filename, size and creation time.

The backend uses SQLite's online backup API, so the snapshot includes committed data in WAL rather than copying only the main database file. SQLite documents the destination transaction and rollback behavior in its [online backup API](https://www.sqlite.org/c3ref/backup_finish.html). The app validates the completed snapshot before publishing the destination file. Exports are limited to 2 GiB; individual imported PDFs remain limited to 100 MiB.

An active focus session is exported at its last confirmed checkpoint. Restoring it later marks it interrupted; elapsed offline time is never inferred.

## Inspect before replacing

Choose **Choose backup to inspect**. This does not replace current learning data. The backend copies the selected file into a private staging directory and validates the complete schema, supported application identity, integrity, foreign keys and asset limits. Unexpected tables, triggers and views are rejected. Database schema revisions 1–7 are supported; this is a schema range, not a list of app release versions.

Older supported databases are migrated only in staging. The original selected file remains unchanged. The preview shows the staged file's saved contents and source/current schema revisions. It lasts 15 minutes; changing the original file after inspection does not change the prepared copy. Inspect again to prepare another version.

Use a standalone exported backup. The app rejects its own live database/working files and inputs with nonempty journal/WAL sidecars. Copying a running database's main file manually can omit saved changes.

## Confirm and restart

Review the counts and the replacement warning. Restore replaces saved data rather than merging histories. Finish an active focus session, then acknowledge that current data/PDFs will be replaced, unsaved drafts discarded and a restart required. **Cancel restore** discards the prepared preview; it does not request replacement.

Before replacement, the app creates a private safety snapshot in the application's `recovery` directory. A shared/exclusive writer gate prevents cooperating app instances from saving between that snapshot and replacement. The validated candidate receives a fresh workspace epoch before SQLite copies it into the same live database. This avoids a database-file swap and invalidates stale writers in other instances.

Successful restore fences learning-data commands until restart. The interface unmounts learner state and polling providers and shows only restart/recovery controls. A lost response can be resolved through the same prepared token or backup-status check; a successful restore is not applied twice. Other instances must restart before saving against the replaced workspace.

The restart screen displays the safety-copy path when available. If automatic restart fails, close and reopen Silicon Quest manually. To return to the previous saved workspace, inspect and restore that safety snapshot after restarting. It has the same private contents and validation requirements as an exported backup.

An unfinished SQLite copy rolls back and retains the safety snapshot. Failed validation never replaces the live workspace. Recovery files are under `<application-data>/recovery/before-restore-<id>.sqlite3`; on macOS the application-data directory is `~/Library/Application Support/com.siliconquest.desktop`. Safety snapshots are retained rather than automatically deleted. Allow disk space for a full staged candidate and safety snapshot, plus SQLite working files; PDF-heavy copies can be large. Normal discard/closure removes staging, but a crash can leave private `.silicon-restore-*` directories. No automatic cleanup or secure-erasure behavior is claimed.

## Verification boundary

Use isolated test databases, never the learner's real workspace, for restore tests. Cover consistent export, PDF/note/progress round trips, legacy migration, corrupt/unexpected schemas, wildcard-looking trigger/view names, expired previews, source/live aliases, interrupted-copy rollback, writer/startup exclusion, fresh epochs, same-token replay and preserved safety data. UI checks cover native-dialog cancellation/results, explicit confirmation, active-focus/draft boundaries, uncertain outcomes, startup status gating, provider teardown and restart failures.

Native dialogs and the complete native backup/restore UI have not been exercised by a GUI smoke test. Backend tests and mocked UI integration tests verify their respective boundaries; the historical reader smoke record makes no backup/restore claim.

Before publication, independent checks passed 47 headless Rust tests, 45 frontend integration tests, TypeScript, the production UI build, Rust formatting and curriculum validation. The backend implementer also ran 47 desktop-feature tests and compiled the native command bindings. All backup/restore fixtures were isolated; the normal learner database was not opened or replaced during this increment.
