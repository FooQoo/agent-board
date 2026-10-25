//! `POST /api/projects/{project_id}/docs/open[?path=…]`. Without a path it opens
//! the project's Docs folder in the computer's file manager; with one it opens
//! that file in the app the computer uses for it, where the user edits it. The
//! path is checked like a read (inside the folder, no links, an existing file).
//! The write guard in `api` checks the request first, and the mobile monitor's
//! router has no such route.

use std::path::Path as FsPath;
use std::process::{Command, Stdio};
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use super::{PathQuery, failure};
use crate::docs::{DocsPath, DocsRoot};
use crate::error::AgboardError;
use crate::server::AppState;
use crate::server::store::{indexed_view, parse_project_id};

pub(crate) async fn open_docs_path(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    Query(query): Query<PathQuery>,
) -> Response {
    let project = match parse_project_id(&raw_project) {
        Ok(project) => project,
        Err(error) => return *failure(error),
    };
    if let Err(error) = indexed_view(&state, &project) {
        return *failure(error);
    }
    let root = DocsRoot::of_project(&state.shared, &project);
    let target = match query.path.as_deref() {
        None => root.dir().to_path_buf(),
        Some(raw) => match checked_file(&root, raw) {
            Ok(file) => file,
            Err(error) => return *failure(error),
        },
    };
    // Starting the program may touch the disk, so it runs off the async threads.
    let started = tokio::task::spawn_blocking(move || start_opener(&target)).await;
    match started {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(reason)) => *failure(AgboardError::DocsOpenFailed { reason }),
        Err(error) => *failure(AgboardError::DocsOpenFailed {
            reason: error.to_string(),
        }),
    }
}

/// The operating systems whose file manager the board can start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Platform {
    MacOs,
    Windows,
    Other,
}

impl Platform {
    const CURRENT: Platform = if cfg!(target_os = "macos") {
        Platform::MacOs
    } else if cfg!(target_os = "windows") {
        Platform::Windows
    } else {
        Platform::Other
    };
}

/// The file at `raw`, checked as a read checks it: a valid path inside the
/// Docs, no links on the way, and an existing file.
fn checked_file(root: &DocsRoot, raw: &str) -> Result<std::path::PathBuf, AgboardError> {
    let path = DocsPath::parse(raw)?;
    root.open_file(&path)?;
    Ok(path
        .elements()
        .iter()
        .fold(root.dir().to_path_buf(), |dir, element| dir.join(element)))
}

/// The program and arguments that open `target` (a folder or a file) on
/// `platform`. The path is one argument of its own and never goes through a shell.
pub(super) fn open_command(platform: Platform, dir: &FsPath) -> (&'static str, Vec<&FsPath>) {
    let program = match platform {
        Platform::MacOs => "open",
        Platform::Windows => "explorer",
        Platform::Other => "xdg-open",
    };
    (program, vec![dir])
}

/// Start the opener on an existing folder or file, without waiting for it to finish.
fn start_opener(target: &FsPath) -> Result<(), String> {
    if !target.exists() {
        return Err(format!("{} does not exist.", target.display()));
    }
    let (program, args) = open_command(Platform::CURRENT, target);
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("cannot start {program}: {error}"))?;
    // Reap the process in the background so it does not stay a zombie.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_platform_starts_its_own_file_manager_with_the_folder_alone() {
        let dir = FsPath::new("/data/shared/projects/p/docs");
        for (platform, program) in [
            (Platform::MacOs, "open"),
            (Platform::Windows, "explorer"),
            (Platform::Other, "xdg-open"),
        ] {
            assert_eq!(open_command(platform, dir), (program, vec![dir]));
        }
    }

    #[test]
    fn a_missing_folder_is_not_started() {
        let result = start_opener(FsPath::new("/nonexistent/agboard-docs"));
        assert!(result.is_err());
    }
}
