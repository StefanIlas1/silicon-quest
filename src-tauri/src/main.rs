#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    #[cfg(feature = "desktop")]
    silicon_quest_lib::run();
}
