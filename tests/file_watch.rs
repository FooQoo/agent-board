//! The serve-side index and the file watcher (AC-3, AC-9, U3-1, U3-3, U3-4).
//! Each test writes into a temporary shared folder from outside the store, the
//! way an agent editing TASK.md does, and checks what the index and the
//! `changed` broadcast report.

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use agent_board::domain::{Actor, Assignee, NewTask, ProjectId};
use agent_board::file_store::FileStore;
use agent_board::file_store::index::{ProjectEntry, ProjectIndex};
use agent_board::file_store::projection::ChangeSet;
use agent_board::file_store::watch::Watch;
use chrono::{TimeZone, Utc};
use tokio::sync::broadcast;

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 10, 0, 0, 0).unwrap()
}

struct Fixture {
    _root: tempfile::TempDir,
    shared: PathBuf,
    project: ProjectId,
    index: Arc<RwLock<ProjectIndex>>,
    changed: broadcast::Receiver<ChangeSet>,
    _watch: Watch,
}

impl Fixture {
    /// One project with one task, the index started on the folder, and a
    /// receiver for the `changed` broadcast.
    async fn start() -> Fixture {
        let root = tempfile::tempdir().unwrap();
        let shared = root.path().join("shared");
        let store = FileStore::open(&shared);
        let project = store.create_project("Alpha", now()).unwrap().id;
        store
            .create_task(
                &project,
                NewTask {
                    title: "First".into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Human,
                    is_draft: false,
                },
                now(),
            )
            .unwrap();
        let index = Arc::new(RwLock::new(ProjectIndex::default()));
        let (sender, changed) = broadcast::channel(16);
        let (watch, _reloader) = Watch::start(&shared, index.clone(), sender).unwrap();
        Fixture {
            _root: root,
            shared,
            project,
            index,
            changed,
            _watch: watch,
        }
    }

    fn task_md(&self) -> PathBuf {
        self.shared
            .join("projects")
            .join(self.project.as_str())
            .join("tasks/1/TASK.md")
    }

    /// Wait up to `limit` for one `changed`; true when it arrived.
    async fn changed_within(&mut self, limit: Duration) -> bool {
        matches!(
            tokio::time::timeout(limit, self.changed.recv()).await,
            Ok(Ok(_))
        )
    }

    /// Drain every `changed` that is already queued.
    fn drain(&mut self) {
        while self.changed.try_recv().is_ok() {}
    }
}

fn body(title: &str) -> String {
    format!(
        "## 作業内容\n\n{title}\n\n## 完了条件と確認結果\n\n- [ ] AC-1. 作業する\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n"
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_external_save_of_task_md_is_seen_without_any_notify() {
    let mut fx = Fixture::start().await;
    fs::write(fx.task_md(), body("Edited outside the store")).unwrap();
    assert!(
        fx.changed_within(Duration::from_secs(3)).await,
        "no changed event after an external save"
    );
    let index = fx.index.read().unwrap();
    match index.entry(&fx.project).unwrap() {
        ProjectEntry::Ready { view, .. } => {
            assert!(
                view.tasks[0]
                    .description
                    .contains("Edited outside the store")
            );
        }
        other => panic!("expected a ready project, got {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn saving_the_same_content_again_sends_no_changed_event() {
    let mut fx = Fixture::start().await;
    let text = body("Same content");
    fs::write(fx.task_md(), &text).unwrap();
    assert!(fx.changed_within(Duration::from_secs(3)).await);
    fx.drain();

    // Same bytes again: the version is a content hash, so nothing changed.
    fs::write(fx.task_md(), &text).unwrap();
    assert!(
        !fx.changed_within(Duration::from_millis(1200)).await,
        "a save of identical content must not announce a change"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn temporary_files_internal_folder_and_readme_do_not_reload_the_project() {
    let mut fx = Fixture::start().await;
    fx.drain();
    let dir = fx.task_md().parent().unwrap().to_path_buf();
    let project_dir = fx.shared.join("projects").join(fx.project.as_str());

    fs::write(dir.join(".TASK.md.tmp-0123456789abcdef"), "half written").unwrap();
    fs::write(project_dir.join("README.md"), "# edited readme").unwrap();
    fs::create_dir_all(project_dir.join(".internal")).unwrap();
    fs::write(project_dir.join(".internal/write.lock"), "").unwrap();
    assert!(
        !fx.changed_within(Duration::from_millis(1200)).await,
        "only canonical files may announce a change"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_defective_project_json_is_invalid_and_recovers_when_fixed() {
    let mut fx = Fixture::start().await;
    let project_json = fx
        .shared
        .join("projects")
        .join(fx.project.as_str())
        .join("project.json");
    let good = fs::read_to_string(&project_json).unwrap();
    fs::write(&project_json, "{ not json").unwrap();
    assert!(fx.changed_within(Duration::from_secs(3)).await);
    {
        let index = fx.index.read().unwrap();
        match index.entry(&fx.project).unwrap() {
            ProjectEntry::Invalid { error, .. } => {
                assert_eq!(error.code(), "file_invalid");
            }
            other => panic!("expected an invalid project, got {other:?}"),
        }
    }
    fx.drain();

    fs::write(&project_json, good).unwrap();
    assert!(fx.changed_within(Duration::from_secs(3)).await);
    let index = fx.index.read().unwrap();
    assert!(matches!(
        index.entry(&fx.project).unwrap(),
        ProjectEntry::Ready { .. }
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_change_is_announced_once_for_a_burst_of_writes() {
    let mut fx = Fixture::start().await;
    fx.drain();
    for n in 0..10 {
        fs::write(fx.task_md(), body(&format!("burst {n}"))).unwrap();
    }
    assert!(fx.changed_within(Duration::from_secs(3)).await);
    assert!(
        !fx.changed_within(Duration::from_millis(1200)).await,
        "a burst within the debounce window must be one announcement"
    );
    let index = fx.index.read().unwrap();
    match index.entry(&fx.project).unwrap() {
        ProjectEntry::Ready { view, .. } => {
            assert!(view.tasks[0].description.contains("burst 9"));
        }
        other => panic!("expected a ready project, got {other:?}"),
    }
}

#[test]
fn the_catalog_version_is_a_32_digit_lowercase_hex_string() {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    store.create_project("Alpha", now()).unwrap();
    let mut index = ProjectIndex::default();
    index.reload_all(&shared).unwrap();
    let version = index.catalog_version();
    assert_eq!(version.len(), 32);
    assert!(
        version
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    );
}

#[test]
fn reloading_without_changes_keeps_the_catalog_version() {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    store.create_project("Alpha", now()).unwrap();
    let mut index = ProjectIndex::default();
    assert!(index.reload_all(&shared).unwrap());
    assert!(!index.reload_all(&shared).unwrap());
}

#[test]
fn a_project_folder_that_is_deleted_leaves_the_index() {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Alpha", now()).unwrap().id;
    let mut index = ProjectIndex::default();
    index.reload_all(&shared).unwrap();
    store.delete_project(&project).unwrap();
    assert!(index.reload_all(&shared).unwrap());
    assert!(index.entry(&project).is_none());
}
