//! One-time, local-only artwork setup. The desktop app never downloads images.
use silicon_quest_lib::store::Store;
use std::{env, fs, path::PathBuf};

fn main() {
    if let Err(message) = run() {
        eprintln!("{message}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.len() < 4 || (args.len() - 1) % 3 != 0 {
        return Err(
            "Usage: import_artwork DATABASE (book|course) ITEM_ID IMAGE [KIND ITEM_ID IMAGE ...]"
                .into(),
        );
    }
    let database = PathBuf::from(&args[0]);
    if !database.is_file() {
        return Err(
            "Choose the existing Silicon Quest database; launch the desktop app once first.".into(),
        );
    }
    let mut store = Store::open(&database).map_err(|e| e.message)?;
    for item in args[1..].chunks_exact(3) {
        let kind = item[0].to_str().ok_or("Invalid artwork kind")?;
        let id = item[1].to_str().ok_or("Invalid item ID")?;
        let file = fs::File::open(&item[2]).map_err(|_| "Cannot open local image")?;
        if !file
            .metadata()
            .map_err(|_| "Cannot inspect local image")?
            .is_file()
        {
            return Err("Choose a regular local image".into());
        }
        use std::io::Read;
        let mut bytes = Vec::new();
        file.take(silicon_quest_lib::artwork::MAX_INPUT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read local image")?;
        let artwork = store
            .save_local_artwork(kind, id, &bytes)
            .map_err(|e| e.message)?;
        println!(
            "Imported {kind}/{id}: {} × {}",
            artwork.width, artwork.height
        );
    }
    Ok(())
}
