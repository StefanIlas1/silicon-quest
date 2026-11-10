pub mod focus;
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
        f(&mut store)
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
    pub fn run() {
        tauri::Builder::default()
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
                get_review_summary
            ])
            .run(tauri::generate_context!())
            .expect("Silicon Quest could not initialize its local desktop window");
    }
}
#[cfg(feature = "desktop")]
pub use desktop::run;
