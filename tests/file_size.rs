//! Rust source files under `src/` stay small enough to read whole. A file counts
//! its lines before its `#[cfg(test)]` module. Integration tests have no limit.
//! The web UI's TypeScript files are checked by Biome (`noExcessiveLinesPerFile`
//! in `web/biome.json`).
//!
//! A file that may stay longer says so on its first line, with a reason:
//! `// file-size: allow (the reason)`.

use std::fs;
use std::path::{Path, PathBuf};

const MAX_LINES: usize = 300;
const ALLOW_MARKER: &str = "// file-size: allow";

fn source_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries {
        let path = entry.expect("read a directory entry").path();
        if path.is_dir() {
            source_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// The reason given by the file's allow marker: `Some("")` for a marker
/// without one, `None` for no marker.
fn allow_reason(text: &str) -> Option<&str> {
    let rest = text.lines().next()?.strip_prefix(ALLOW_MARKER)?.trim();
    Some(
        rest.strip_prefix('(')
            .and_then(|r| r.strip_suffix(')'))
            .unwrap_or("")
            .trim(),
    )
}

/// The lines that count toward the limit.
fn counted_lines(text: &str) -> usize {
    text.lines()
        .take_while(|line| !line.starts_with("#[cfg(test)]"))
        .count()
}

#[test]
fn production_source_files_stay_within_the_line_limit() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    source_files(&root.join("src"), &mut files);
    assert!(!files.is_empty(), "no source files were found");

    let mut problems = Vec::new();
    for path in files {
        let name = path
            .strip_prefix(root)
            .expect("a file under the repository")
            .to_string_lossy()
            .replace('\\', "/");
        let text = fs::read_to_string(&path).expect("read a source file");
        let lines = counted_lines(&text);
        match allow_reason(&text) {
            Some("") => problems.push(format!(
                "{name}: give a reason in its marker, as `{ALLOW_MARKER} (the reason)`."
            )),
            Some(_) if lines <= MAX_LINES => problems.push(format!(
                "{name}: {lines} lines fits the limit. Remove its `{ALLOW_MARKER}` line."
            )),
            Some(_) => {}
            None if lines > MAX_LINES => problems.push(format!(
                "{name}: {lines} lines, over the limit of {MAX_LINES}. Split it into smaller modules."
            )),
            None => {}
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}
