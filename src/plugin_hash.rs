//! The content hash of the Agent Board plugin's files.
//!
//! The build script hashes `plugins/agent-board/` and embeds the result; the
//! hook and `agboard setup` hash the same relative files of an installed plugin
//! and compare. The set is every regular file under the plugin folder (a
//! `.DS_Store` excluded), by path relative to it with `/` separators. Files an
//! agent adds to its installed copy are not part of the set, so they never
//! change the result; a missing file does.
//!
//! This file uses the standard library only: `build.rs` includes it.

use std::path::Path;

/// Files that are never part of the plugin.
const IGNORED: [&str; 1] = [".DS_Store"];

/// Every file under `root`, relative and sorted. `None` when `root` cannot be
/// read.
#[allow(dead_code)]
pub fn list_files(root: &Path) -> Option<Vec<String>> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) -> Option<()> {
        for entry in std::fs::read_dir(dir).ok()? {
            let entry = entry.ok()?;
            let name = entry.file_name().into_string().ok()?;
            if IGNORED.contains(&name.as_str()) {
                continue;
            }
            let relative = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if entry.file_type().ok()?.is_dir() {
                walk(&entry.path(), &relative, out)?;
            } else {
                out.push(relative);
            }
        }
        Some(())
    }
    let mut files = Vec::new();
    walk(root, "", &mut files)?;
    files.sort();
    Some(files)
}

/// The hash of `files` (relative paths) under `root`, as 16 hex digits.
/// `None` when a file cannot be read.
///
/// It is FNV-1a over each path and content, length-prefixed so that moving
/// bytes between files changes the result. It detects change; it is not a
/// defence against someone who edits the plugin on purpose.
pub fn hash_files<S: AsRef<str>>(root: &Path, files: &[S]) -> Option<String> {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    for file in files {
        let relative = file.as_ref();
        let content = std::fs::read(root.join(relative)).ok()?;
        feed(&(relative.len() as u64).to_le_bytes());
        feed(relative.as_bytes());
        feed(&(content.len() as u64).to_le_bytes());
        feed(&content);
    }
    Some(format!("{hash:016x}"))
}
