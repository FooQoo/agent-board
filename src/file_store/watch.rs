//! Watching the shared folder for changes (ARCHITECTURE.md, "更新通知").
//!
//! `notify` reports paths on its own thread; the path is turned into a target
//! (one project, or the whole catalog) and queued. A tokio task keeps a
//! deadline per target, moved 200 ms forward by every new event, and reloads
//! the target when the deadline passes. The index compares the projection before and after the
//! reload, and the change sets it found go to the sink, so a save that changes no parsed data
//! is silent.
//!
//! Temporary files and `.internal/` are not canonical data, and neither is the
//! project README; their events are dropped before they reach the queue. The
//! project's `docs/` folder is the user's own files, not board data: its events
//! wait out the same 200 ms and then go to the docs sink, without a reload.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tokio::time::Instant;

use super::FileStore;
use super::index::ProjectIndex;
use super::projection::ChangeSink;
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
    /// Something in one project's `docs/` folder; announced, never loaded.
    Docs(ProjectId),
}

/// Told that files in a project's Docs changed: `Some(project)`, or `None` when
/// the platform lost events and any project's Docs may have changed.
#[derive(Clone)]
pub struct DocsSink(Arc<dyn Fn(Option<ProjectId>) + Send + Sync>);

impl DocsSink {
    pub fn new(send: impl Fn(Option<ProjectId>) + Send + Sync + 'static) -> DocsSink {
        DocsSink(Arc::new(send))
    }

    /// A sink for a caller that does not follow the Docs.
    pub fn none() -> DocsSink {
        DocsSink::new(|_| {})
    }
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
        // The Docs are the user's files: they are announced, not loaded as board data.
        [projects, id, docs, ..] if projects == "projects" && docs == "docs" => {
            ProjectId::from_str(id).ok().map(Target::Docs)
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
        changed: impl Into<ChangeSink>,
    ) -> Result<(Watch, Reloader), AgboardError> {
        Watch::start_with_docs(shared, index, changed, DocsSink::none())
    }

    /// [`Watch::start`], also telling `docs` about changes in the projects' Docs.
    pub fn start_with_docs(
        shared: &Path,
        index: Arc<RwLock<ProjectIndex>>,
        changed: impl Into<ChangeSink>,
        docs: DocsSink,
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

        // Reconcile completed AI work before the first snapshot is published.
        FileStore::open(&root).auto_complete_all(chrono::Utc::now())?;
        // A guide run whose tab was closed while the server was down is taken back now.
        FileStore::open(&root).guide_recover(chrono::Utc::now())?;

        {
            let mut guard = index.write().unwrap_or_else(|e| e.into_inner());
            guard.reload_all(&root)?;
            // The first read is the baseline, not a change.
            guard.take_changes();
        }
        tokio::spawn(reload_loop(rx, root, index, changed.into(), docs));
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
    changed: ChangeSink,
    docs: DocsSink,
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
                for target in &ready {
                    match target {
                        Target::Docs(id) => (docs.0)(Some(id.clone())),
                        // Lost events may have been in any project's Docs.
                        Target::All => (docs.0)(None),
                        Target::Project(_) => {}
                    }
                }
                let ready: Vec<Target> =
                    ready.into_iter().filter(|target| !matches!(target, Target::Docs(_))).collect();
                if ready.is_empty() {
                    continue;
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

/// Reload the ready targets and announce the changes the reload found.
fn apply(root: &Path, index: &RwLock<ProjectIndex>, changed: &ChangeSink, ready: &[Target]) {
    // A canonical file save (including a direct TASK.md edit) may complete a
    // task. Reconcile before loading the version that clients will observe.
    let store = FileStore::open(root);
    if ready.contains(&Target::All) {
        if let Ok(projects) = store.projects() {
            for project in projects {
                let _ = store.auto_complete_project(&project.id, chrono::Utc::now());
            }
        }
    } else {
        for target in ready {
            if let Target::Project(id) = target {
                let _ = store.auto_complete_project(id, chrono::Utc::now());
            }
        }
    }

    let mut guard = index.write().unwrap_or_else(|e| e.into_inner());
    if ready.contains(&Target::All) {
        let _ = guard.reload_all(root);
    } else {
        for target in ready {
            if let Target::Project(id) = target {
                guard.reload_project(root, id);
            }
        }
    }
    let found = guard.take_changes();
    drop(guard);
    for set in found {
        changed.send(set);
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
            .join("epics/EPIC-1/EPIC.md");
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
    fn the_docs_folder_and_everything_in_it_are_docs_not_board_data() {
        for rest in [
            "docs",
            "docs/a.md",
            "docs/sub/b.md",
            "docs/sub/tasks/1/TASK.md",
        ] {
            let path = shared().join("projects").join(ID).join(rest);
            assert_eq!(
                classify(&shared(), &path),
                Some(Target::Docs(ID.parse().unwrap())),
                "{rest}"
            );
        }
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
