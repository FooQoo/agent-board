//! The pixel size of an attachment, read from the file header and remembered in the process.

use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use image::ImageReader;

/// How many sizes the process keeps; the map starts over when it is full.
const CACHE_LIMIT: usize = 4096;

fn cache() -> &'static Mutex<HashMap<PathBuf, (u32, u32)>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, (u32, u32)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Width and height in pixels, when the header of the file at `path` can be read (PNG, JPEG,
/// GIF or WebP). An attachment file never changes under its ID, so a size that was read is kept
/// for the life of the process; a file that cannot be read is tried again next time.
pub fn dimensions(path: &Path) -> Option<(u32, u32)> {
    if let Some(known) = cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(path)
        .copied()
    {
        return Some(known);
    }
    let size = read_header(path)?;
    let mut map = cache().lock().unwrap_or_else(|e| e.into_inner());
    if map.len() >= CACHE_LIMIT {
        map.clear();
    }
    map.insert(path.to_path_buf(), size);
    Some(size)
}

/// Only the header is decoded; the pixels are never read.
fn read_header(path: &Path) -> Option<(u32, u32)> {
    let file = File::open(path).ok()?;
    ImageReader::new(BufReader::new(file))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{DynamicImage, ImageFormat, RgbaImage};

    use super::*;

    fn encoded(format: ImageFormat, width: u32, height: u32) -> Vec<u8> {
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
            width,
            height,
            image::Rgba([10, 20, 30, 255]),
        ));
        let image = if format == ImageFormat::Jpeg {
            DynamicImage::ImageRgb8(image.to_rgb8())
        } else {
            image
        };
        let mut out = Cursor::new(Vec::new());
        image.write_to(&mut out, format).unwrap();
        out.into_inner()
    }

    fn file(dir: &tempfile::TempDir, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = dir.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn png_jpeg_gif_and_webp_report_their_size() {
        let dir = tempfile::tempdir().unwrap();
        for (format, name) in [
            (ImageFormat::Png, "a.png"),
            (ImageFormat::Jpeg, "b.jpg"),
            (ImageFormat::Gif, "c.gif"),
            (ImageFormat::WebP, "d.webp"),
        ] {
            let path = file(&dir, name, &encoded(format, 37, 21));
            assert_eq!(dimensions(&path), Some((37, 21)), "{name}");
        }
    }

    #[test]
    fn a_broken_or_missing_file_has_no_size() {
        let dir = tempfile::tempdir().unwrap();
        let png = encoded(ImageFormat::Png, 8, 8);
        for (name, bytes) in [
            ("empty.png", Vec::new()),
            ("text.png", b"not an image at all".to_vec()),
            ("cut.png", png[..12].to_vec()),
            ("cut.jpg", encoded(ImageFormat::Jpeg, 8, 8)[..6].to_vec()),
        ] {
            let path = file(&dir, name, &bytes);
            assert_eq!(dimensions(&path), None, "{name}");
        }
        assert_eq!(dimensions(&dir.path().join("missing.png")), None);
    }

    #[test]
    fn a_size_is_remembered_by_the_process() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "e.png", &encoded(ImageFormat::Png, 5, 6));
        assert_eq!(dimensions(&path), Some((5, 6)));
        std::fs::remove_file(&path).unwrap();
        assert_eq!(dimensions(&path), Some((5, 6)));
    }
}
