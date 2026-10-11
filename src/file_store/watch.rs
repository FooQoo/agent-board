//! Watching the shared folder for changes (ARCHITECTURE.md, "更新通知").
//!
//! `notify` reports paths on its own thread; the path is turned into a target
//! (one project, or the whole catalog) and queued. A tokio task keeps a
//! deadline per target, moved 200 ms forward by every new event, and reloads
//! the target when the deadline passes. The `changed` broadcast is sent only
//! when the catalog version changed, so a save of identical content is silent.
//!
//! Temporary files and `.internal/` are not canonical data, and neither is the
//! project README; their events are dropped before they reach the queue.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::{broadcast, mpsc};
use tokio::time::Instant;

use super::index::ProjectIndex;
use crate::domain::ProjectId;
use crate::error::{AgboardError, FileAction};

/// How long a target waits for further events before it is reloaded.
pub const DEBOUNCE: Duration = Duration::from_millis(200);

/// What a queued event asks the reloader to read again.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Target {
    /// One project folder.
    Project(ProjectId),
    /// Every project, and the list of projects itself.
    All,
}

/// Holds the OS watch. Dropping it stops the events.
pub struct Watch {
    _watcher: RecommendedWatcher,
}

/// Queues reloads from inside the server (after a save, or `POST /api/notify`).
/// Cheap to clone and safe to share between request handlers.
#[derive(Debug, Clone)]
pub struct Reloader {
    tx: mpsc::UnboundedSender<Target>,
}

impl Reloader {
    pub fn project(&self, id: &ProjectId) {
        let _ = self.tx.send(Target::Project(id.clone()));
    }

    pub fn all(&self) {
        let _ = self.tx.send(Target::All);
    }
}

/// The target of one path below `shared`, or `None` when the path is not
/// canonical data: anything with a dot-prefixed name, `README.md` at the
/// project root, and paths outside `projects/`.
pub fn classify(shared: &Path, path: &Path) -> Option<Target> {
    let rest = path.strip_prefix(shared).ok()?;
    let parts: Vec<String> = rest
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if parts.iter().any(|part| part.starts_with('.')) {
        return None;
    }
    match parts.as_slice() {
        [name] if name == "workspace.json" || name == "projects" => Some(Target::All),
        [projects, id] if projects == "projects" => {
            ProjectId::from_str(id).ok().map(|_| Target::All)
        }
        [projects, _, file] if projects == "projects" && file == "README.md" => None,
        [projects, id, ..] if projects == "projects" => {
            ProjectId::from_str(id).ok().map(Target::Project)
        }
        _ => None,
    }
}

impl Watch {
    /// Start watching `shared` (created if needed) and the reload task. The
    /// index is read once after the watch exists, so a change made during
    /// that read is queued and read again. Must be called inside a tokio runtime.
    pub fn start(
        shared: &Path,
        index: Arc<RwLock<ProjectIndex>>,
        changed: broadcast::Sender<()>,
    ) -> Result<(Watch, Reloader), AgboardError> {
        std::fs::create_dir_all(shared).map_err(|e| watch_error(shared, e))?;
        let root = shared.canonicalize().map_err(|e| watch_error(shared, e))?;
        let (tx, rx) = mpsc::unbounded_channel::<Target>();

        let sender = tx.clone();
        let handler_root = root.clone();
        let mut watcher = notify::recommended_watcher(
            move |result: notify::Result<notify::Event>| match result {
                Ok(event) if !event.need_rescan() => {
                    for path in &event.paths {
                        if let Some(target) = classify(&handler_root, path) {
                            let _ = sender.send(target);
                        }
                    }
                }
                // The platform lost events: read everything again.
                _ => {
                    let _ = sender.send(Target::All);
                }
            },
        )
        .map_err(|e| watch_error(shared, e))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| watch_error(shared, e))?;

        {
            let mut guard = index.write().unwrap_or_else(|e| e.into_inner());
            guard.reload_all(&root)?;
        }
        tokio::spawn(reload_loop(rx, root, index, changed));
        Ok((Watch { _watcher: watcher }, Reloader { tx }))
    }
}

fn watch_error(shared: &Path, error: impl std::fmt::Display) -> AgboardError {
    AgboardError::FileError {
        action: FileAction::Read,
        file: shared.display().to_string(),
        reason: format!("Cannot watch the shared folder: {error}"),
    }
}

/// Collects targets until each one is quiet for `DEBOUNCE`, then reloads it.
async fn reload_loop(
    mut rx: mpsc::UnboundedReceiver<Target>,
    root: PathBuf,
    index: Arc<RwLock<ProjectIndex>>,
    changed: broadcast::Sender<()>,
) {
    let mut due: HashMap<Target, Instant> = HashMap::new();
    loop {
        let next = due.values().min().copied();
        tokio::select! {
            received = rx.recv() => match received {
                Some(target) => {
                    due.insert(target, Instant::now() + DEBOUNCE);
                }
                None => break,
            },
            () = wait_until(next) => {
                let now = Instant::now();
                let ready: Vec<Target> = due
                    .iter()
                    .filter(|(_, at)| **at <= now)
                    .map(|(target, _)| target.clone())
                    .collect();
                for target in &ready {
                    due.remove(target);
                }
                let root = root.clone();
                let index = index.clone();
                let changed = changed.clone();
                let _ = tokio::task::spawn_blocking(move || apply(&root, &index, &changed, &ready)).await;
            }
        }
    }
}

async fn wait_until(at: Option<Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

/// Reload the ready targets and announce a change when the catalog changed.
fn apply(
    root: &Path,
    index: &RwLock<ProjectIndex>,
    changed: &broadcast::Sender<()>,
    ready: &[Target],
) {
    let mut guard = index.write().unwrap_or_else(|e| e.into_inner());
    let mut changed_now = false;
    if ready.contains(&Target::All) {
        changed_now |= guard.reload_all(root).unwrap_or(false);
    } else {
        for target in ready {
            if let Target::Project(id) = target {
                changed_now |= guard.reload_project(root, id);
            }
        }
    }
    drop(guard);
    if changed_now {
        let _ = changed.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0123456789abcdef0123456789abcdef";

    fn shared() -> PathBuf {
        PathBuf::from("/data/shared")
    }

    #[test]
    fn canonical_project_files_map_to_their_project() {
        let id = ProjectId::from_str(ID).unwrap();
        let task = shared().join("projects").join(ID).join("tasks/1/TASK.md");
        assert_eq!(
            classify(&shared(), &task),
            Some(Target::Project(id.clone()))
        );
        let epic = shared()
            .join("projects")
            .join(ID)
            .join("epics/EPIC-1/PLAN.md");
        assert_eq!(classify(&shared(), &epic), Some(Target::Project(id)));
    }

    #[test]
    fn dot_names_internal_files_and_the_readme_are_ignored() {
        let base = shared().join("projects").join(ID);
        for path in [
            base.join("tasks/1/.TASK.md.tmp-0123"),
            base.join(".internal/write.lock"),
            base.join("README.md"),
            shared().join("projects/.new-0123/project.json"),
            shared().join(".deleting-0123"),
        ] {
            assert_eq!(classify(&shared(), &path), None, "{}", path.display());
        }
    }

    #[test]
    fn project_folders_and_the_workspace_file_reload_the_catalog() {
        assert_eq!(
            classify(&shared(), &shared().join("workspace.json")),
            Some(Target::All)
        );
        assert_eq!(
            classify(&shared(), &shared().join("projects").join(ID)),
            Some(Target::All)
        );
        assert_eq!(
            classify(&shared(), &shared().join("projects")),
            Some(Target::All)
        );
    }

    #[test]
    fn paths_outside_the_shared_folder_are_ignored() {
        assert_eq!(
            classify(&shared(), Path::new("/elsewhere/projects/x")),
            None
        );
        assert_eq!(
            classify(
                &shared(),
                &shared().join("projects/not-an-id/tasks/1/TASK.md")
            ),
            None
        );
    }
}
