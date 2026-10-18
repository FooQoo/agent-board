//! The web UI build output the server embeds. Shared with `build.rs`, which
//! includes this file directly, so it must not depend on the rest of the crate.

use std::path::Path;

/// Files `pnpm --dir web build` must produce under `web/dist/`.
/// The scripts and stylesheets are named by their content, so `build.rs`
/// checks them through the files the HTML names.
pub const REQUIRED_FILES: [&str; 3] = ["index.html", "logo.png", "logo-white.png"];

pub const ACCESS_REQUIRED_FILES: [&str; 2] = ["index.html", "entry.js"];
pub const MONITOR_REQUIRED_FILES: [&str; 1] = ["index.html"];

/// Required files missing beneath one isolated web asset namespace.
pub fn missing_namespace_files<'a>(
    dist: &Path,
    namespace: &str,
    required: &'a [&'a str],
) -> Vec<&'a str> {
    required
        .iter()
        .copied()
        .filter(|rel| !dist.join(namespace).join(rel).is_file())
        .collect()
}

/// Actionable error for an incomplete isolated web build.
pub fn namespace_error_message(namespace: &str, missing: &[&str]) -> String {
    format!(
        "error: the {namespace} web assets are not built (missing in web/dist/{namespace}: {}).\nRun \"pnpm --dir web build\" first.",
        missing.join(", ")
    )
}

/// The required files that do not exist under `dist`.
pub fn missing_files(dist: &Path) -> Vec<&'static str> {
    REQUIRED_FILES
        .into_iter()
        .filter(|rel| !dist.join(rel).is_file())
        .collect()
}

/// The message that stops the build when the web UI has not been built.
pub fn error_message(missing: &[&str]) -> String {
    format!(
        "error: the web UI is not built (missing in web/dist: {}).\nRun \"pnpm --dir web build\" first.",
        missing.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dist: &Path, rel: &str) {
        let path = dist.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }

    #[test]
    fn a_missing_directory_misses_every_file() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(
            missing_files(&tmp.path().join("dist")),
            vec!["index.html", "logo.png", "logo-white.png"]
        );
    }

    #[test]
    fn only_the_absent_files_are_reported() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "index.html");
        touch(tmp.path(), "logo-white.png");
        assert_eq!(missing_files(tmp.path()), vec!["logo.png"]);
    }

    #[test]
    fn a_complete_build_misses_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        for rel in REQUIRED_FILES {
            touch(tmp.path(), rel);
        }
        assert!(missing_files(tmp.path()).is_empty());
    }

    #[test]
    fn a_directory_in_place_of_a_file_does_not_count() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "logo.png");
        touch(tmp.path(), "logo-white.png");
        std::fs::create_dir_all(tmp.path().join("index.html")).unwrap();
        assert_eq!(missing_files(tmp.path()), vec!["index.html"]);
    }

    #[test]
    fn the_message_tells_how_to_build_and_names_the_files() {
        let message = error_message(&["index.html", "logo.png"]);
        assert!(message.contains("Run \"pnpm --dir web build\" first."));
        assert!(message.contains("index.html, logo.png"));
    }

    #[test]
    fn incomplete_access_and_monitor_builds_name_the_files_and_build_command() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(
            missing_namespace_files(tmp.path(), "access", &ACCESS_REQUIRED_FILES),
            vec!["index.html", "entry.js"]
        );
        assert_eq!(
            missing_namespace_files(tmp.path(), "monitor", &MONITOR_REQUIRED_FILES),
            vec!["index.html"]
        );
        assert!(
            namespace_error_message("access", &["entry.js"])
                .contains("Run \"pnpm --dir web build\" first.")
        );
        assert!(
            namespace_error_message("monitor", &["index.html"])
                .contains("missing in web/dist/monitor: index.html")
        );
    }
}
