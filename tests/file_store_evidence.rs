//! Text evidence owned by a task on the shared files (AC-10 storage layer,
//! U4-3 and U4-5): UTF-8 only, owner checks, path rules, and limits.

use std::fs;
use std::path::{Path, PathBuf};

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::file_store::layout;
use chrono::{TimeZone, Utc};

const MIB: usize = 1024 * 1024;

fn at(day: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, day, 0, 0, 0).unwrap()
}

struct Fixture {
    _root: tempfile::TempDir,
    outside: PathBuf,
    store: FileStore,
    project: ProjectId,
    project_dir: PathBuf,
}

fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let outside = root.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let store = FileStore::open(&shared);
    let project = store.create_project("Alpha", at(4)).unwrap().id;
    let project_dir = shared.join("projects").join(project.as_str());
    Fixture {
        _root: root,
        outside,
        store,
        project,
        project_dir,
    }
}

impl Fixture {
    fn task(&self) -> i64 {
        self.store
            .create_task(
                &self.project,
                NewTask {
                    title: "Task".into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                    is_draft: false,
                },
                at(4),
            )
            .unwrap()
            .id
    }

    fn evidence_dir(&self, task: i64) -> PathBuf {
        self.project_dir
            .join("tasks")
            .join(task.to_string())
            .join("evidence")
    }

    fn task_json(&self, task: i64) -> serde_json::Value {
        let text = fs::read_to_string(
            self.project_dir
                .join("tasks")
                .join(task.to_string())
                .join("task.json"),
        )
        .unwrap();
        serde_json::from_str(&text).unwrap()
    }
}

fn id(n: u32) -> String {
    format!("{n:032x}")
}

#[test]
fn agents_cannot_add_or_delete_evidence_after_a_task_is_done() {
    let f = fixture();
    let task = f.task();
    let record = f
        .store
        .add_evidence(&f.project, task, "run.log", b"kept", at(5))
        .unwrap();
    f.store
        .move_work_task_for_user(
            &f.project,
            task,
            Column::Done,
            ChangeContext {
                actor: Actor::Human,
                reason: "Verified".into(),
            },
            at(6),
        )
        .unwrap();

    assert!(
        matches!(f.store.add_evidence(&f.project, task, "next.log", b"new", at(7)), Err(AgboardError::TaskIsDone { id }) if id == task)
    );
    assert!(
        matches!(f.store.delete_evidence(&f.project, task, &record.id, at(7)), Err(AgboardError::TaskIsDone { id }) if id == task)
    );
    assert_eq!(
        f.store
            .read_evidence(&f.project, task, &record.id)
            .unwrap()
            .bytes,
        b"kept"
    );
}

#[test]
fn text_evidence_is_saved_under_the_task_and_read_back_byte_for_byte() {
    let f = fixture();
    let task = f.task();
    let text = "line one\r\nline two 日本語 🚀\nno trailing newline".as_bytes();

    let record = f
        .store
        .add_evidence(&f.project, task, "run.log", text, at(5))
        .unwrap();

    assert_eq!(record.name, "run.log");
    assert_eq!(record.size, text.len() as i64);
    assert_eq!(record.created_at, at(5));
    assert_eq!(record.id.len(), 32);
    let file = f.evidence_dir(task).join(format!("{}.log", record.id));
    assert_eq!(fs::read(&file).unwrap(), text);
    assert_eq!(f.task_json(task)["evidence"][0]["id"], record.id.as_str());

    let data = f.store.read_evidence(&f.project, task, &record.id).unwrap();
    assert_eq!(data.bytes, text);
    assert_eq!(data.record, record);
}

#[test]
fn evidence_must_be_non_empty_utf8_text() {
    let f = fixture();
    let task = f.task();
    let err = f
        .store
        .add_evidence(&f.project, task, "bin.log", &[0xff, 0xfe, 0x00], at(5))
        .unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");

    let err = f
        .store
        .add_evidence(&f.project, task, "empty.log", b"", at(5))
        .unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");

    assert!(f.task_json(task)["evidence"].as_array().unwrap().is_empty());
    assert!(!f.evidence_dir(task).exists());
}

#[test]
fn evidence_is_checked_against_the_task_that_owns_it() {
    let f = fixture();
    let owner = f.task();
    let other = f.task();
    let record = f
        .store
        .add_evidence(&f.project, owner, "run.log", b"owned", at(5))
        .unwrap();
    let file = f.evidence_dir(owner).join(format!("{}.log", record.id));

    let err = f
        .store
        .read_evidence(&f.project, other, &record.id)
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::EvidenceNotFound { .. }),
        "{err:?}"
    );
    assert_eq!(err.code(), "evidence_not_found");

    let err = f
        .store
        .delete_evidence(&f.project, other, &record.id, at(6))
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::EvidenceNotFound { .. }),
        "{err:?}"
    );
    assert!(file.is_file(), "the owner's file is untouched");
}

#[test]
fn path_like_evidence_ids_are_refused() {
    let f = fixture();
    let task = f.task();
    f.store
        .add_evidence(&f.project, task, "run.log", b"x", at(5))
        .unwrap();

    for bad in ["../task", "../../project", "/etc/passwd", "ABC"] {
        let err = f.store.read_evidence(&f.project, task, bad).unwrap_err();
        assert!(
            matches!(err, AgboardError::EvidenceNotFound { .. }),
            "{bad}: {err:?}"
        );
    }

    let err = layout::evidence_path(&f.project_dir, task, "../x").unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
    let err = layout::evidence_path(&f.project_dir, 0, &id(1)).unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
}

#[test]
fn archived_and_draft_tasks_refuse_evidence_changes_but_allow_reads() {
    let f = fixture();
    let archived = f.task();
    let kept = f
        .store
        .add_evidence(&f.project, archived, "kept.log", b"kept", at(5))
        .unwrap();
    f.store.archive_task(&f.project, archived, at(5)).unwrap();

    let err = f
        .store
        .add_evidence(&f.project, archived, "new.log", b"new", at(6))
        .unwrap_err();
    assert!(matches!(err, AgboardError::TaskArchived { .. }), "{err:?}");
    let err = f
        .store
        .delete_evidence(&f.project, archived, &kept.id, at(6))
        .unwrap_err();
    assert!(matches!(err, AgboardError::TaskArchived { .. }), "{err:?}");
    let data = f
        .store
        .read_evidence(&f.project, archived, &kept.id)
        .unwrap();
    assert_eq!(data.bytes, b"kept");

    let draft = f.task();
    f.store.set_draft(&f.project, draft, true, at(5)).unwrap();
    let err = f
        .store
        .add_evidence(&f.project, draft, "new.log", b"new", at(6))
        .unwrap_err();
    assert!(matches!(err, AgboardError::TaskIsDraft { .. }), "{err:?}");
}

#[test]
fn deleting_evidence_removes_its_record_and_file() {
    let f = fixture();
    let task = f.task();
    let record = f
        .store
        .add_evidence(&f.project, task, "run.log", b"gone soon", at(5))
        .unwrap();
    let file = f.evidence_dir(task).join(format!("{}.log", record.id));

    f.store
        .delete_evidence(&f.project, task, &record.id, at(6))
        .unwrap();

    assert!(!file.exists());
    assert!(f.task_json(task)["evidence"].as_array().unwrap().is_empty());
    let err = f
        .store
        .read_evidence(&f.project, task, &record.id)
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::EvidenceNotFound { .. }),
        "{err:?}"
    );
    let err = f
        .store
        .delete_evidence(&f.project, task, &record.id, at(7))
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::EvidenceNotFound { .. }),
        "{err:?}"
    );
}

#[test]
fn a_symbolic_link_in_the_evidence_folder_is_not_read() {
    let f = fixture();
    let task = f.task();
    let record = f
        .store
        .add_evidence(&f.project, task, "run.log", b"inside", at(5))
        .unwrap();
    let dir = f.evidence_dir(task);
    let moved = f.outside.join("moved-evidence");
    fs::rename(&dir, &moved).unwrap();
    symlink(&moved, &dir);

    let err = f
        .store
        .read_evidence(&f.project, task, &record.id)
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::EvidenceNotFound { .. }),
        "{err:?}"
    );

    let err = f
        .store
        .add_evidence(&f.project, task, "new.log", b"new", at(6))
        .unwrap_err();
    assert!(matches!(err, AgboardError::FileError { .. }), "{err:?}");
    assert!(!moved.join(format!("{}.log", id(99))).exists());
}

#[test]
fn the_evidence_limits_follow_the_image_limits() {
    let f = fixture();
    let task = f.task();
    for _ in 0..20 {
        f.store
            .add_evidence(&f.project, task, "run.log", b"x", at(5))
            .unwrap();
    }
    let err = f
        .store
        .add_evidence(&f.project, task, "run.log", b"x", at(5))
        .unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
    assert_eq!(f.task_json(task)["evidence"].as_array().unwrap().len(), 20);

    let other = f.task();
    let big = vec![b'a'; 11 * MIB];
    let err = f
        .store
        .add_evidence(&f.project, other, "big.log", &big, at(5))
        .unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
}

#[test]
fn an_evidence_name_keeps_only_its_last_part() {
    let f = fixture();
    let task = f.task();
    let record = f
        .store
        .add_evidence(&f.project, task, "../../logs/run.log", b"x", at(5))
        .unwrap();
    assert_eq!(record.name, "run.log");
    let err = f
        .store
        .add_evidence(&f.project, task, "", b"x", at(5))
        .unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
}

#[cfg(unix)]
fn symlink(target: &Path, link: &Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}
