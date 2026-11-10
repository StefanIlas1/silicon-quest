//! Private artwork: decode bounded raster input and store only a normalized PNG.
//! Neither source paths nor EXIF metadata are retained; SVG and URLs are excluded.
use crate::{
    backup,
    store::{Result, Store},
};
use image::{ImageFormat, ImageReader, Limits};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use std::io::Cursor;

pub const MAX_INPUT_BYTES: u64 = 10 * 1024 * 1024;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub updated_at: String,
}
fn invalid() -> crate::store::AppError {
    backup::error(
        "invalid_artwork",
        "Choose a valid PNG or JPEG under 10 MB and at most 4096 × 4096 pixels.",
    )
}
pub(crate) fn known_item(kind: &str, id: &str) -> bool {
    let field = match kind {
        "book" => "books",
        "course" => "credentials",
        _ => return false,
    };
    let catalog: serde_json::Value =
        serde_json::from_str(include_str!("../../curriculum/data.json"))
            .expect("bundled curriculum");
    catalog[field]
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item["id"].as_str() == Some(id)))
}
fn check_item(kind: &str, id: &str) -> Result<()> {
    if !known_item(kind, id) {
        return Err(backup::error(
            "invalid_artwork",
            "Choose a known book or course.",
        ));
    }
    Ok(())
}
fn decode(bytes: &[u8]) -> Result<image::DynamicImage> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_INPUT_BYTES {
        return Err(invalid());
    }
    let format = image::guess_format(bytes).map_err(|_| invalid())?;
    if !matches!(format, ImageFormat::Png | ImageFormat::Jpeg) {
        return Err(invalid());
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    reader.decode().map_err(|_| invalid())
}
pub(crate) fn validate_integrity(conn: &Connection) -> Result<()> {
    let invalid_sizes: i64 = conn.query_row("SELECT count(*) FROM local_artwork WHERE length(bytes)<1 OR length(bytes)>10485760 OR length(item_id)>100 OR length(updated_at)>100", [], |r| r.get(0))?;
    if invalid_sizes > 0 {
        return Err(invalid());
    }
    let count: i64 = conn.query_row("SELECT count(*) FROM local_artwork", [], |r| r.get(0))?;
    if count > 100 {
        return Err(invalid());
    }
    let mut statement =
        conn.prepare("SELECT kind,item_id,bytes,width,height,updated_at FROM local_artwork")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let kind: String = row.get(0)?;
        let id: String = row.get(1)?;
        check_item(&kind, &id)?;
        let bytes: Vec<u8> = row.get(2)?;
        let width: u32 = row.get(3)?;
        let height: u32 = row.get(4)?;
        let timestamp: String = row.get(5)?;
        if image::guess_format(&bytes).ok() != Some(ImageFormat::Png)
            || !(1..=1600).contains(&width)
            || !(1..=1600).contains(&height)
            || chrono::DateTime::parse_from_rfc3339(&timestamp).is_err()
        {
            return Err(invalid());
        }
        let decoded = decode(&bytes)?;
        if decoded.width() != width || decoded.height() != height {
            return Err(invalid());
        }
    }
    Ok(())
}
impl Store {
    pub fn get_local_artwork(&self, kind: &str, item_id: &str) -> Result<Option<Artwork>> {
        self.ensure_available()?;
        check_item(kind, item_id)?;
        Ok(self.conn.query_row("SELECT bytes,width,height,updated_at FROM local_artwork WHERE kind=?1 AND item_id=?2", params![kind,item_id], |r| Ok(Artwork { bytes:r.get(0)?, width:r.get(1)?, height:r.get(2)?, updated_at:r.get(3)? })).optional()?)
    }
    pub fn save_local_artwork(
        &mut self,
        kind: &str,
        item_id: &str,
        bytes: &[u8],
    ) -> Result<Artwork> {
        self.ensure_available()?;
        check_item(kind, item_id)?;
        let decoded = decode(bytes)?;
        // Re-encoding strips source metadata. Bound display and backup size.
        let normalized = if decoded.width() > 1600 || decoded.height() > 1600 {
            decoded.thumbnail(1600, 1600).to_rgba8()
        } else {
            decoded.to_rgba8()
        };
        let width = normalized.width();
        let height = normalized.height();
        let mut output = Cursor::new(Vec::new());
        normalized
            .write_to(&mut output, ImageFormat::Png)
            .map_err(|_| invalid())?;
        let bytes = output.into_inner();
        if bytes.len() as u64 > MAX_INPUT_BYTES {
            return Err(invalid());
        }
        let _gate = backup::shared_gate(self.write_gate.as_ref())?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        backup::ensure_epoch(&tx, &self.data_epoch)?;
        let updated_at = chrono::Utc::now().to_rfc3339();
        tx.execute("INSERT INTO local_artwork(kind,item_id,bytes,width,height,updated_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(kind,item_id) DO UPDATE SET bytes=excluded.bytes,width=excluded.width,height=excluded.height,updated_at=excluded.updated_at", params![kind,item_id,bytes,width,height,updated_at])?;
        tx.commit()?;
        Ok(Artwork {
            bytes,
            width,
            height,
            updated_at,
        })
    }
    pub fn remove_local_artwork(&mut self, kind: &str, item_id: &str) -> Result<()> {
        self.ensure_available()?;
        check_item(kind, item_id)?;
        let _gate = backup::shared_gate(self.write_gate.as_ref())?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        backup::ensure_epoch(&tx, &self.data_epoch)?;
        tx.execute(
            "DELETE FROM local_artwork WHERE kind=?1 AND item_id=?2",
            params![kind, item_id],
        )?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> Store {
        Store::initialize(Connection::open_in_memory().unwrap()).unwrap()
    }
    pub(crate) fn png() -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        image::RgbaImage::from_pixel(3, 5, image::Rgba([30, 60, 90, 255]))
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    }
    #[test]
    fn artwork_is_private_per_item_and_independent_of_progress() {
        let mut store = store();
        store
            .save_note("cache-locality", "Preserve my study note")
            .unwrap();
        store.save_local_artwork("book", "csapp", &png()).unwrap();
        store
            .save_local_artwork("course", "cuda-dli", &png())
            .unwrap();
        assert_eq!(
            store
                .get_local_artwork("book", "csapp")
                .unwrap()
                .unwrap()
                .height,
            5
        );
        assert!(store.get_local_artwork("book", "ostep").unwrap().is_none());
        store.remove_local_artwork("book", "csapp").unwrap();
        assert!(store.get_local_artwork("book", "csapp").unwrap().is_none());
        assert!(store
            .get_local_artwork("course", "cuda-dli")
            .unwrap()
            .is_some());
        assert_eq!(
            store.dashboard().unwrap().notes[0].body,
            "Preserve my study note"
        );
        assert_eq!(store.dashboard().unwrap().total_xp, 0);
    }
    #[test]
    fn invalid_payloads_and_unknown_items_preserve_previous_artwork() {
        let mut store = store();
        let original = store
            .save_local_artwork("book", "csapp", &png())
            .unwrap()
            .bytes;
        for bytes in [
            b"<svg xmlns='http://www.w3.org/2000/svg'/>".as_slice(),
            b"https://example.com/image.png",
            b"\x89PNG\r\n\x1a\n",
        ] {
            assert!(store.save_local_artwork("book", "csapp", bytes).is_err());
        }
        assert!(store.save_local_artwork("book", "unknown", &png()).is_err());
        assert!(store.save_local_artwork("course", "csapp", &png()).is_err());
        assert_eq!(
            store
                .get_local_artwork("book", "csapp")
                .unwrap()
                .unwrap()
                .bytes,
            original
        );
    }
    #[test]
    fn jpeg_is_normalized_and_large_dimensions_rejected_before_replacing_cover() {
        let mut store = store();
        let mut jpeg = Cursor::new(Vec::new());
        image::RgbImage::from_pixel(8, 12, image::Rgb([20, 40, 60]))
            .write_to(&mut jpeg, ImageFormat::Jpeg)
            .unwrap();
        let saved = store
            .save_local_artwork("book", "csapp", &jpeg.into_inner())
            .unwrap();
        assert_eq!(image::guess_format(&saved.bytes).unwrap(), ImageFormat::Png);
        assert_eq!((saved.width, saved.height), (8, 12));
        let mut oversized = Cursor::new(Vec::new());
        image::RgbaImage::new(4097, 1)
            .write_to(&mut oversized, ImageFormat::Png)
            .unwrap();
        assert!(store
            .save_local_artwork("book", "csapp", &oversized.into_inner())
            .is_err());
        assert_eq!(
            store
                .get_local_artwork("book", "csapp")
                .unwrap()
                .unwrap()
                .bytes,
            saved.bytes
        );
    }
    #[test]
    fn artwork_backup_round_trip_and_corruption_validation() {
        let directory = tempfile::tempdir().unwrap();
        let live = directory.path().join("live.sqlite3");
        let backup = directory.path().join("backup.sqlite3");
        let mut store = Store::open(&live).unwrap();
        let original = store
            .save_local_artwork("book", "csapp", &png())
            .unwrap()
            .bytes;
        store
            .save_local_artwork("course", "cuda-dli", &png())
            .unwrap();
        store.export_backup_file(&backup).unwrap();
        store.remove_local_artwork("book", "csapp").unwrap();
        let preview = store.inspect_backup_file(&backup).unwrap();
        assert_eq!(preview.counts.artwork, 2);
        assert!(preview.counts.artwork_bytes > 0);
        store.restore_backup(&preview.preview_token).unwrap();
        assert_eq!(
            store
                .remove_local_artwork("course", "cuda-dli")
                .unwrap_err()
                .code,
            "restart_required"
        );
        drop(store);
        let mut restored = Store::open(&live).unwrap();
        assert_eq!(
            restored
                .get_local_artwork("book", "csapp")
                .unwrap()
                .unwrap()
                .bytes,
            original
        );
        assert!(restored
            .get_local_artwork("course", "cuda-dli")
            .unwrap()
            .is_some());
        let conn = Connection::open(&backup).unwrap();
        conn.execute("UPDATE local_artwork SET bytes=x'89504e470d0a1a0a'", [])
            .unwrap();
        drop(conn);
        assert!(restored.inspect_backup_file(&backup).is_err());
        assert_eq!(
            restored
                .get_local_artwork("book", "csapp")
                .unwrap()
                .unwrap()
                .bytes,
            original
        );
    }
}
