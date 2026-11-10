pub mod backup;
pub mod chapters;
pub mod credentials;
pub mod focus;
pub mod projects;
pub mod review;
pub mod store;

#[cfg(feature = "desktop")]
mod desktop {
    use super::store::*;
    use std::sync::Mutex;
    use tauri::{Manager, State};
    struct AppState(Mutex<Store>);
    fn with_store<T>(
        state: State<'_, AppState>,
        f: impl FnOnce(&mut Store) -> Result<T>,
    ) -> Result<T> {
        let mut store = state.0.lock().map_err(|_| AppError {
            code: "storage_unavailable",
            message: "Local storage is unavailable. Restart Silicon Quest to reconnect.".into(),
        })?;
        store.ensure_available()?;
        f(&mut store)
    }
    #[tauri::command]
    fn get_book_chapters(
        state: State<'_, AppState>,
        book_id: String,
    ) -> Result<crate::chapters::ChapterIndex> {
        with_store(state, |store| store.get_book_chapters(&book_id))
    }
    #[tauri::command]
    fn save_book_chapter(
        state: State<'_, AppState>,
        book_id: String,
        input: crate::chapters::ChapterInput,
    ) -> Result<crate::chapters::ChapterIndex> {
        with_store(state, |store| store.save_book_chapter(&book_id, input))
    }
    #[tauri::command]
    fn get_dashboard(state: State<'_, AppState>) -> Result<Dashboard> {
        with_store(state, |s| s.dashboard())
    }
    #[tauri::command]
    fn set_topic_status(
        state: State<'_, AppState>,
        topic_id: String,
        status: String,
    ) -> Result<Dashboard> {
        with_store(state, |s| s.set_topic_status(&topic_id, &status))
    }
    #[tauri::command]
    fn save_note(state: State<'_, AppState>, topic_id: String, body: String) -> Result<Dashboard> {
        with_store(state, |s| s.save_note(&topic_id, &body))
    }
    #[tauri::command]
    fn get_quiz(state: State<'_, AppState>, topic_id: String) -> Result<Quiz> {
        with_store(state, |s| s.get_quiz(&topic_id))
    }
    #[tauri::command]
    fn submit_quiz(
        state: State<'_, AppState>,
        topic_id: String,
        answers: Vec<usize>,
        attempt_id: String,
    ) -> Result<QuizResult> {
        with_store(state, |s| s.submit_quiz(&topic_id, answers, &attempt_id))
    }
    #[tauri::command]
    fn import_book_pdf(
        state: State<'_, AppState>,
        book_id: String,
        file_name: String,
        bytes: Vec<u8>,
    ) -> Result<BookDocument> {
        with_store(state, |s| s.import_book_pdf(&book_id, &file_name, &bytes))
    }
    #[tauri::command]
    fn get_book_document(
        state: State<'_, AppState>,
        book_id: String,
    ) -> Result<Option<BookDocument>> {
        with_store(state, |s| s.get_book_document(&book_id))
    }
    #[tauri::command]
    fn get_book_pdf(
        state: State<'_, AppState>,
        book_id: String,
        document_revision: Option<String>,
    ) -> Result<Vec<u8>> {
        with_store(state, |s| {
            s.get_book_pdf_for_revision(&book_id, document_revision.as_deref())
        })
    }
    #[tauri::command]
    fn get_book_reader_state(
        state: State<'_, AppState>,
        book_id: String,
    ) -> Result<BookReaderState> {
        with_store(state, |s| s.get_book_reader_state(&book_id))
    }
    #[tauri::command]
    fn set_book_page(
        state: State<'_, AppState>,
        book_id: String,
        page: i64,
        document_revision: String,
    ) -> Result<()> {
        with_store(state, |s| {
            s.set_book_page(&book_id, page, &document_revision)
        })
    }
    #[tauri::command]
    fn add_bookmark(
        state: State<'_, AppState>,
        book_id: String,
        page: i64,
        label: String,
        document_revision: String,
    ) -> Result<BookReaderState> {
        with_store(state, |s| {
            s.add_bookmark(&book_id, page, &label, &document_revision)
        })
    }
    #[tauri::command]
    fn remove_bookmark(
        state: State<'_, AppState>,
        book_id: String,
        bookmark_id: String,
        document_revision: String,
    ) -> Result<BookReaderState> {
        with_store(state, |s| {
            s.remove_bookmark(&book_id, &bookmark_id, &document_revision)
        })
    }
    #[tauri::command]
    fn get_focus_summary(state: State<'_, AppState>) -> Result<crate::focus::FocusSummary> {
        with_store(state, |s| s.get_focus_summary())
    }
    #[tauri::command]
    fn start_focus_session(
        state: State<'_, AppState>,
        topic_id: String,
        request_id: String,
    ) -> Result<crate::focus::FocusSummary> {
        with_store(state, |s| s.start_focus_session(&topic_id, &request_id))
    }
    #[tauri::command]
    fn tick_focus_session(
        state: State<'_, AppState>,
        session_id: String,
        sequence: i64,
    ) -> Result<crate::focus::FocusSummary> {
        with_store(state, |s| {
            s.tick_focus_session(&session_id, sequence, false)
        })
    }
    #[tauri::command]
    fn end_focus_session(
        state: State<'_, AppState>,
        session_id: String,
        sequence: i64,
    ) -> Result<crate::focus::FocusSummary> {
        with_store(state, |s| s.tick_focus_session(&session_id, sequence, true))
    }
    #[tauri::command]
    fn get_review_summary(state: State<'_, AppState>) -> Result<crate::review::ReviewSummary> {
        with_store(state, |s| s.get_review_summary())
    }
    #[tauri::command]
    async fn export_local_backup(
        app: tauri::AppHandle,
    ) -> Result<Option<crate::backup::ExportReport>> {
        tauri::async_runtime::spawn_blocking(move || {
            use tauri_plugin_dialog::DialogExt;
            let selected = app
                .dialog()
                .file()
                .set_title("Export private Silicon Quest backup")
                .set_file_name("silicon-quest-backup.sqlite3")
                .add_filter("Silicon Quest backup", &["sqlite3"])
                .blocking_save_file();
            let Some(selected) = selected else {
                return Ok(None);
            };
            let path = selected.into_path().map_err(|_| {
                crate::backup::error("backup_io", "Choose a local backup destination.")
            })?;
            with_store(app.state::<AppState>(), |store| {
                store.export_backup_file(&path).map(Some)
            })
        })
        .await
        .map_err(|_| crate::backup::error("backup_io", "The backup operation could not finish."))?
    }
    #[tauri::command]
    async fn inspect_local_backup(
        app: tauri::AppHandle,
    ) -> Result<Option<crate::backup::BackupPreview>> {
        tauri::async_runtime::spawn_blocking(move || {
            use tauri_plugin_dialog::DialogExt;
            let selected = app
                .dialog()
                .file()
                .set_title("Inspect a Silicon Quest backup")
                .add_filter("Silicon Quest backup", &["sqlite3", "sqlite", "db"])
                .blocking_pick_file();
            let Some(selected) = selected else {
                return Ok(None);
            };
            let path = selected.into_path().map_err(|_| {
                crate::backup::error("backup_io", "Choose a local standalone backup file.")
            })?;
            with_store(app.state::<AppState>(), |store| {
                store.inspect_backup_file(&path).map(Some)
            })
        })
        .await
        .map_err(|_| crate::backup::error("backup_io", "Backup inspection could not finish."))?
    }
    #[tauri::command]
    fn discard_backup_preview(state: State<'_, AppState>, preview_token: String) -> Result<()> {
        with_store(state, |store| store.discard_backup_preview(&preview_token))
    }
    #[tauri::command]
    async fn restore_local_backup(
        app: tauri::AppHandle,
        preview_token: String,
    ) -> Result<crate::backup::RestoreReport> {
        tauri::async_runtime::spawn_blocking(move || {
            let state=app.state::<AppState>();
            let mut store=state.0.lock().map_err(|_|crate::backup::error("storage_unavailable","Restart Silicon Quest to reconnect to local storage."))?;
            // This route alone permits an idempotent committed-token reply while
            // the workspace is fenced pending process restart.
            store.restore_backup(&preview_token)
        }).await.map_err(|_|crate::backup::error("backup_io","The restore operation could not finish. Retry the same preview to check its result."))?
    }
    #[tauri::command]
    fn get_backup_status(state: State<'_, AppState>) -> Result<crate::backup::BackupStatus> {
        let store = state.0.lock().map_err(|_| {
            crate::backup::error(
                "storage_unavailable",
                "Restart Silicon Quest to reconnect to local storage.",
            )
        })?;
        store.backup_status()
    }
    #[tauri::command]
    fn restart_after_restore(app: tauri::AppHandle) -> Result<()> {
        let restart = {
            let state = app.state::<AppState>();
            let store = state.0.lock().map_err(|_| {
                crate::backup::error(
                    "storage_unavailable",
                    "Quit and reopen Silicon Quest to reconnect to local storage.",
                )
            })?;
            store.backup_status()?.restart_required
        };
        if !restart {
            return Err(crate::backup::error(
                "invalid_input",
                "No restored workspace is waiting for restart.",
            ));
        }
        app.restart()
    }
    #[tauri::command]
    fn get_project_summary(state: State<'_, AppState>) -> Result<crate::projects::ProjectSummary> {
        with_store(state, |store| store.get_project_summary())
    }
    #[tauri::command]
    fn save_project_milestone(
        state: State<'_, AppState>,
        milestone_id: String,
        task_checks: Vec<crate::projects::TaskCheck>,
        evidence_note: String,
        status: String,
        expected_version: i64,
        request_id: String,
    ) -> Result<crate::projects::ProjectMutationResult> {
        with_store(state, |store| {
            store.save_project_milestone(
                &milestone_id,
                task_checks,
                &evidence_note,
                &status,
                expected_version,
                &request_id,
            )
        })
    }
    #[tauri::command]
    fn review_project_milestone(
        state: State<'_, AppState>,
        milestone_id: String,
        review_note: String,
        confirm_reviewed: bool,
        expected_version: i64,
        request_id: String,
    ) -> Result<crate::projects::ProjectMutationResult> {
        with_store(state, |store| {
            store.review_project_milestone(
                &milestone_id,
                &review_note,
                confirm_reviewed,
                expected_version,
                &request_id,
            )
        })
    }
    #[tauri::command]
    fn reopen_project_milestone(
        state: State<'_, AppState>,
        milestone_id: String,
        reason: String,
        expected_version: i64,
        request_id: String,
    ) -> Result<crate::projects::ProjectMutationResult> {
        with_store(state, |store| {
            store.reopen_project_milestone(&milestone_id, &reason, expected_version, &request_id)
        })
    }
    #[tauri::command]
    fn get_credential_summary(
        state: State<'_, AppState>,
    ) -> Result<crate::credentials::CredentialSummary> {
        with_store(state, |store| store.get_credential_summary())
    }
    #[tauri::command]
    fn save_credential_progress(
        state: State<'_, AppState>,
        credential_id: String,
        status: String,
        target_date: Option<String>,
        evidence_note: String,
        evidence_reference: String,
        confirm_completed: bool,
        expected_version: i64,
        request_id: String,
    ) -> Result<crate::credentials::CredentialMutationResult> {
        with_store(state, |store| {
            store.save_credential_progress(
                &credential_id,
                &status,
                target_date.as_deref(),
                &evidence_note,
                &evidence_reference,
                confirm_completed,
                expected_version,
                &request_id,
            )
        })
    }
    pub fn run() {
        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .setup(|app| {
                let directory = app.path().app_data_dir()?;
                // Development smoke tests use isolated storage; release builds always
                // use the platform app-data path.
                #[cfg(debug_assertions)]
                let directory = std::env::var_os("SILICON_QUEST_TEST_DATA_DIR")
                    .map(std::path::PathBuf::from)
                    .unwrap_or(directory);
                std::fs::create_dir_all(&directory)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
                }
                let database = directory.join("silicon-quest.sqlite3");
                let store = Store::open(&database).map_err(|e| std::io::Error::other(e.message))?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&database, std::fs::Permissions::from_mode(0o600))?;
                }
                app.manage(AppState(Mutex::new(store)));
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                get_dashboard,
                get_book_chapters,
                save_book_chapter,
                set_topic_status,
                save_note,
                get_quiz,
                submit_quiz,
                import_book_pdf,
                get_book_document,
                get_book_pdf,
                get_book_reader_state,
                set_book_page,
                add_bookmark,
                remove_bookmark,
                get_focus_summary,
                start_focus_session,
                tick_focus_session,
                end_focus_session,
                get_review_summary,
                export_local_backup,
                inspect_local_backup,
                discard_backup_preview,
                restore_local_backup,
                get_backup_status,
                restart_after_restore,
                get_project_summary,
                save_project_milestone,
                review_project_milestone,
                reopen_project_milestone,
                get_credential_summary,
                save_credential_progress
            ])
            .run(tauri::generate_context!())
            .expect("Silicon Quest could not initialize its local desktop window");
    }
}
#[cfg(feature = "desktop")]
pub use desktop::run;
