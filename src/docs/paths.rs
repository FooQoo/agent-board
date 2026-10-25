//! Docs paths: a validated relative path, and its resolution under a Docs root.
//!
//! Resolution walks the root one element at a time and refuses symlinks, then
//! opens the file with `O_NOFOLLOW` on Unix. Limit: with the standard library
//! alone, a parent folder swapped for a link between the check and the open is
//! not caught.

use std::fs::{self, File, OpenOptions};
use std::io::ErrorKind;
use std::path::PathBuf;

use super::model::{DocsError, DocsRoot};
use super::{MAX_ELEMENT_BYTES, MAX_PATH_BYTES, MAX_TREE_DEPTH};
use crate::file_store::io::read_error;

/// A relative path of `/`-separated elements that stays inside the Docs root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocsPath {
    elements: Vec<String>,
}

fn invalid(reason: &str) -> DocsError {
    DocsError::DocsPathInvalid {
        reason: reason.to_string(),
    }
}

impl DocsPath {
    /// Any entry: a folder or a file of any type.
    pub fn parse(raw: &str) -> Result<DocsPath, DocsError> {
        if raw.is_empty() {
            return Err(invalid("The path is empty."));
        }
        if raw.len() > MAX_PATH_BYTES {
            return Err(invalid("The path is too long."));
        }
        if raw.contains('\\') || raw.chars().any(char::is_control) {
            return Err(invalid(
                "Paths use / and no backslashes or control characters.",
            ));
        }
        let elements: Vec<String> = raw.split('/').map(str::to_string).collect();
        if elements.len() > MAX_TREE_DEPTH + 1 {
            return Err(invalid("The path is nested too deeply."));
        }
        for element in &elements {
            if element.is_empty() {
                return Err(invalid(
                    "Paths are relative to the Docs folder, with no empty parts.",
                ));
            }
            if element.starts_with('.') {
                return Err(invalid(
                    "Parts that start with a dot, such as .. and .git, are not served.",
                ));
            }
            if element.len() > MAX_ELEMENT_BYTES {
                return Err(invalid("A part of the path is too long."));
            }
        }
        Ok(DocsPath { elements })
    }

    /// A Markdown file for the file API: the last element ends in `.md` or `.mdx`, in any case.
    pub fn parse_markdown(raw: &str) -> Result<DocsPath, DocsError> {
        let path = DocsPath::parse(raw)?;
        if !matches!(path.extension().as_deref(), Some("md" | "mdx")) {
            return Err(DocsError::DocsNotMarkdown {
                path: path.as_string(),
            });
        }
        Ok(path)
    }

    pub fn as_string(&self) -> String {
        self.elements.join("/")
    }

    pub fn elements(&self) -> &[String] {
        &self.elements
    }

    /// The last element's extension in lowercase, if it has one.
    pub fn extension(&self) -> Option<String> {
        let name = self.elements.last()?;
        let (stem, extension) = name.rsplit_once('.')?;
        (!stem.is_empty()).then(|| extension.to_lowercase())
    }
}

impl DocsRoot {
    /// Open the file at `path` for reading, refusing symlinks in the file and in
    /// every folder above it.
    pub fn open_file(&self, path: &DocsPath) -> Result<File, DocsError> {
        let label = path.as_string();
        let not_found = || DocsError::DocsNotFound {
            path: label.clone(),
        };
        let mut current: PathBuf = self.dir().to_path_buf();
        let last = path.elements().len() - 1;
        for (index, element) in path.elements().iter().enumerate() {
            current.push(element);
            let meta = fs::symlink_metadata(&current).map_err(|error| match error.kind() {
                ErrorKind::NotFound | ErrorKind::NotADirectory => not_found(),
                _ => read_error(&label, error),
            })?;
            if meta.file_type().is_symlink() {
                return Err(invalid("Links inside the Docs folder are not followed."));
            }
            let wanted = if index == last {
                meta.is_file()
            } else {
                meta.is_dir()
            };
            if !wanted {
                return Err(not_found());
            }
        }
        let file = open_no_follow(&current).map_err(|error| {
            if is_symlink_refusal(&error) {
                invalid("Links inside the Docs folder are not followed.")
            } else {
                match error.kind() {
                    ErrorKind::NotFound => not_found(),
                    _ => read_error(&label, error),
                }
            }
        })?;
        match file.metadata() {
            Ok(meta) if meta.is_file() => Ok(file),
            Ok(_) => Err(not_found()),
            Err(error) => Err(read_error(&label, error)),
        }
    }
}

#[cfg(unix)]
fn open_no_follow(path: &std::path::Path) -> std::io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(not(unix))]
fn open_no_follow(path: &std::path::Path) -> std::io::Result<File> {
    OpenOptions::new().read(true).open(path)
}

#[cfg(unix)]
fn is_symlink_refusal(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(libc::ELOOP)
}

#[cfg(not(unix))]
fn is_symlink_refusal(_error: &std::io::Error) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(result: Result<DocsPath, DocsError>) -> String {
        result.unwrap_err().code().to_string()
    }

    #[test]
    fn bad_paths_are_refused() {
        for raw in [
            "",
            "/x.md",
            "../x.md",
            "a/../x.md",
            "./x.md",
            "a/./x.md",
            "a//b.md",
            "a/",
            "a\\b.md",
            "a\0b.md",
            ".hidden/x.md",
            "a/.x.md",
            "C:\\x.md",
            "a\nb.md",
        ] {
            assert_eq!(
                code(DocsPath::parse_markdown(raw)),
                "docs_path_invalid",
                "{raw:?}"
            );
            assert_eq!(code(DocsPath::parse(raw)), "docs_path_invalid", "{raw:?}");
        }
    }

    #[test]
    fn too_long_paths_are_refused() {
        let element = format!("{}.md", "a".repeat(256));
        assert_eq!(
            code(DocsPath::parse_markdown(&element)),
            "docs_path_invalid"
        );
        let whole = vec!["a".repeat(100); 11].join("/") + ".md";
        assert_eq!(code(DocsPath::parse_markdown(&whole)), "docs_path_invalid");
        let deep = vec!["d"; 17].join("/") + "/x.md";
        assert_eq!(code(DocsPath::parse_markdown(&deep)), "docs_path_invalid");
    }

    #[test]
    fn the_file_api_needs_markdown_and_other_entries_do_not() {
        assert_eq!(code(DocsPath::parse_markdown("x.txt")), "docs_not_markdown");
        assert_eq!(code(DocsPath::parse_markdown("md")), "docs_not_markdown");
        assert!(DocsPath::parse("x.txt").is_ok());
        assert!(DocsPath::parse("product").is_ok());
    }

    #[test]
    fn good_paths_are_accepted() {
        for raw in [
            "product/tasks.md",
            "設計/仕様書.md",
            "A.MD",
            "a b/c.Md",
            "a..b.md",
        ] {
            let path = DocsPath::parse_markdown(raw).unwrap();
            assert_eq!(path.as_string(), raw);
        }
        assert_eq!(
            DocsPath::parse("img/a.PNG").unwrap().extension().as_deref(),
            Some("png")
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_files_and_folders_are_refused_and_plain_files_open() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "secret").unwrap();
        let root_dir = dir.path().join("root");
        fs::create_dir_all(root_dir.join("real")).unwrap();
        fs::write(root_dir.join("real/ok.md"), "ok").unwrap();
        symlink(outside.path().join("secret.md"), root_dir.join("link.md")).unwrap();
        symlink(outside.path(), root_dir.join("linked")).unwrap();
        symlink(root_dir.join("real"), root_dir.join("alias")).unwrap();
        let root = DocsRoot::at(&root_dir);
        let open = |raw: &str| root.open_file(&DocsPath::parse(raw).unwrap());

        assert!(open("real/ok.md").is_ok());
        for raw in ["link.md", "linked/secret.md", "alias/ok.md"] {
            assert_eq!(open(raw).unwrap_err().code(), "docs_path_invalid", "{raw}");
        }
        assert_eq!(
            open("real/missing.md").unwrap_err().code(),
            "docs_not_found"
        );
        assert_eq!(open("real").unwrap_err().code(), "docs_not_found");
        assert_eq!(
            open("real/ok.md/x.md").unwrap_err().code(),
            "docs_not_found"
        );
        let missing_root = DocsRoot::at(dir.path().join("nothing"));
        let path = DocsPath::parse_markdown("a.md").unwrap();
        assert_eq!(
            missing_root.open_file(&path).unwrap_err().code(),
            "docs_not_found"
        );
    }
}
