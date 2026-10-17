//! Images owned by a task or an epic on the shared files (AC-10 storage layer,
//! U4-3 and U4-4): owner checks, path rules, symbolic links, and the limits.

use std::fs;
use std::path::{Path, PathBuf};

use agent_board::domain::{
    Actor, Assignee, AttachmentInput, ChangeContext, Column, NewTask, ProjectId,
};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::file_store::layout;
use agent_board::file_store::model::AttachmentOwner;
use agent_board::file_store::validate::EpicId;
use chrono::{TimeZone, Utc};

const MIB: usize = 1024 * 1024;

fn at(day: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, day, 0, 0, 0).unwrap()
}

/// A valid 1x1 PNG.
fn png() -> Vec<u8> {
    vec![
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240,
        31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]
}

/// A valid 1x1 GIF with a comment extension of `comment_len` bytes, so the file
/// has the size asked for. The decoder skips comments.
fn gif_of_size(size: usize) -> Vec<u8> {
    let base: Vec<u8> = vec![
        71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 255, 255, 255, 0, 0, 0, 33, 249, 4, 1, 0, 0,
        0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
    ];
    // Header and color table are the first 19 bytes; the rest follows.
    let (head, tail) = base.split_at(19);
    // Each sub-block carries up to 255 bytes plus a length byte.
    let budget = size - base.len() - 2 - 1;
    let payload_len = budget * 255 / 256;
    let mut out = head.to_vec();
    out.push(33);
    out.push(254);
    let payload = vec![b'x'; payload_len];
    for chunk in payload.chunks(255) {
        out.push(chunk.len() as u8);
        out.extend_from_slice(chunk);
    }
    out.push(0);
    out.extend_from_slice(tail);
    out
}

fn input(id: &str, name: &str, bytes: Vec<u8>) -> AttachmentInput {
    AttachmentInput {
        id: id.into(),
        name: name.into(),
        bytes,
    }
}

fn id(n: u32) -> String {
    format!("{n:032x}")
}

#[test]
fn agents_cannot_add_or_delete_task_images_after_a_task_is_done() {
    let f = fixture();
    let task = f.task();
    let owner = AttachmentOwner::Task(task);
    let saved = f
        .store
        .add_attachment(
            &f.project,
            &owner,
            input(&id(1), "before.png", png()),
            at(5),
        )
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
        matches!(f.store.add_attachment(&f.project, &owner, input(&id(2), "after.png", png()), at(7)), Err(AgboardError::TaskIsDone { id }) if id == task)
    );
    assert!(
        matches!(f.store.delete_attachment(&f.project, &owner, &saved.id, at(7)), Err(AgboardError::TaskIsDone { id }) if id == task)
    );
    assert!(
        f.store
            .attachment_path(&f.project, &owner, &saved.id)
            .is_ok()
    );
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

    fn epic(&self, text: &str) -> AttachmentOwner {
        let id = EpicId::normalize(text).unwrap();
        self.store
            .create_epic(
                &self.project,
                agent_board::file_store::model::NewEpic {
                    id: text.into(),
                    name: "Epic".into(),
                    color: Some("#7C3AED".into()),
                    is_draft: false,
                    plan: None,
                },
                at(4),
            )
            .unwrap();
        AttachmentOwner::Epic(id)
    }

    fn task_assets(&self, task: i64) -> PathBuf {
        self.project_dir
            .join("tasks")
            .join(task.to_string())
            .join("assets")
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

#[test]
fn a_task_image_is_saved_under_its_assets_folder_and_resolves_to_its_path() {
    let f = fixture();
    let task = f.task();
    let owner = AttachmentOwner::Task(task);
    let added = f
        .store
        .add_attachment(&f.project, &owner, input(&id(1), "shot.png", png()), at(5))
        .unwrap();

    assert_eq!(added.id, id(1));
    assert_eq!(added.name, "shot.png");
    assert_eq!(added.media_type, "image/png");
    assert_eq!(added.size, png().len() as i64);
    assert_eq!(added.created_at, at(5));

    let file = f.task_assets(task).join(format!("{}.png", id(1)));
    assert_eq!(fs::read(&file).unwrap(), png());
    assert_eq!(f.task_json(task)["attachments"][0]["id"], id(1));
    assert_eq!(f.task_json(task)["updatedAt"], "2026-10-05T00:00:00Z");

    let stored = f.store.attachment_path(&f.project, &owner, &id(1)).unwrap();
    assert_eq!(stored.path, file);
    assert_eq!(stored.metadata.media_type, "image/png");
}

#[test]
fn an_epic_image_is_saved_under_the_epic_folder() {
    let f = fixture();
    let owner = f.epic("FILE-SHARE");
    f.store
        .add_attachment(&f.project, &owner, input(&id(2), "plan.png", png()), at(5))
        .unwrap();

    let file = f
        .project_dir
        .join("epics")
        .join("FILE-SHARE")
        .join("assets")
        .join(format!("{}.png", id(2)));
    assert!(file.is_file());
    let stored = f.store.attachment_path(&f.project, &owner, &id(2)).unwrap();
    assert_eq!(stored.path, file);
}

#[test]
fn a_name_with_directories_keeps_only_its_last_part() {
    let f = fixture();
    let task = f.task();
    let owner = AttachmentOwner::Task(task);
    let added = f
        .store
        .add_attachment(
            &f.project,
            &owner,
            input(&id(3), "../../etc/passwd.png", png()),
            at(5),
        )
        .unwrap();
    assert_eq!(added.name, "passwd.png");
    assert!(f.task_assets(task).join(format!("{}.png", id(3))).is_file());
}

#[test]
fn an_image_id_of_another_owner_is_refused_in_every_direction() {
    let f = fixture();
    let first = f.task();
    let second = f.task();
    let epic = f.epic("ALPHA");
    f.store
        .add_attachment(
            &f.project,
            &AttachmentOwner::Task(first),
            input(&id(4), "a.png", png()),
            at(5),
        )
        .unwrap();

    let other_task = AttachmentOwner::Task(second);
    let err = f
        .store
        .attachment_path(&f.project, &other_task, &id(4))
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::AttachmentNotFound { .. }),
        "{err:?}"
    );
    let err = f
        .store
        .attachment_path(&f.project, &epic, &id(4))
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::AttachmentNotFound { .. }),
        "{err:?}"
    );

    let err = f
        .store
        .delete_attachment(&f.project, &other_task, &id(4), at(6))
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::AttachmentNotFound { .. }),
        "{err:?}"
    );
    assert!(
        f.task_assets(first)
            .join(format!("{}.png", id(4)))
            .is_file(),
        "the other owner's file is untouched"
    );
}

#[test]
fn path_like_attachment_ids_are_refused_and_nothing_is_written() {
    let f = fixture();
    let task = f.task();
    let owner = AttachmentOwner::Task(task);

    let err = f
        .store
        .add_attachment(
            &f.project,
            &owner,
            input("../escape", "x.png", png()),
            at(5),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
    assert!(!f.task_assets(task).exists());

    let err = f
        .store
        .attachment_path(&f.project, &owner, "../../task")
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::AttachmentNotFound { .. }),
        "{err:?}"
    );

    let err = layout::task_asset_path(&f.project_dir, task, "../x", "png").unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
    let err = layout::task_asset_path(&f.project_dir, task, &id(5), "../png").unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
    let err = layout::task_asset_path(&f.project_dir, 0, &id(5), "png").unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
    let err = layout::epic_asset_path(
        &f.project_dir,
        &EpicId::normalize("ALPHA").unwrap(),
        "/abs",
        "png",
    )
    .unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
}

#[test]
fn an_image_over_10_mib_is_refused_and_nothing_is_written() {
    let f = fixture();
    let task = f.task();
    let mut big = png();
    big.resize(11 * MIB, 0);
    let err = f
        .store
        .add_attachment(
            &f.project,
            &AttachmentOwner::Task(task),
            input(&id(6), "big.png", big),
            at(5),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
    assert!(!f.task_assets(task).exists());
    assert!(
        f.task_json(task)["attachments"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn the_twenty_first_image_of_one_owner_is_refused() {
    let f = fixture();
    let task = f.task();
    let owner = AttachmentOwner::Task(task);
    for n in 0..20 {
        f.store
            .add_attachment(
                &f.project,
                &owner,
                input(&id(100 + n), "a.png", png()),
                at(5),
            )
            .unwrap();
    }
    let err = f
        .store
        .add_attachment(&f.project, &owner, input(&id(200), "a.png", png()), at(5))
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::AttachmentLimitExceeded),
        "{err:?}"
    );
    assert_eq!(
        f.task_json(task)["attachments"].as_array().unwrap().len(),
        20
    );
    assert!(
        !f.task_assets(task)
            .join(format!("{}.png", id(200)))
            .exists()
    );
}

#[test]
fn the_total_of_fifty_mib_is_enforced_per_owner() {
    let f = fixture();
    let task = f.task();
    let owner = AttachmentOwner::Task(task);
    let almost_ten_mib = gif_of_size(10 * MIB - 4096);
    assert!(almost_ten_mib.len() <= 10 * MIB);
    for n in 0..5 {
        f.store
            .add_attachment(
                &f.project,
                &owner,
                input(&id(300 + n), "big.gif", almost_ten_mib.clone()),
                at(5),
            )
            .unwrap();
    }
    let err = f
        .store
        .add_attachment(
            &f.project,
            &owner,
            input(&id(400), "over.gif", gif_of_size(32 * 1024)),
            at(5),
        )
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::AttachmentLimitExceeded),
        "{err:?}"
    );
}

#[test]
fn a_file_that_is_not_png_jpeg_webp_or_gif_is_refused() {
    let f = fixture();
    let task = f.task();
    let err = f
        .store
        .add_attachment(
            &f.project,
            &AttachmentOwner::Task(task),
            input(&id(7), "note.txt", b"plain text".to_vec()),
            at(5),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
}

#[test]
fn a_symbolic_link_in_the_owner_folder_is_refused_for_reads_and_writes() {
    let f = fixture();
    let task = f.task();
    let owner = AttachmentOwner::Task(task);
    f.store
        .add_attachment(&f.project, &owner, input(&id(8), "a.png", png()), at(5))
        .unwrap();

    let assets = f.task_assets(task);
    let moved = f.outside.join("moved-assets");
    fs::rename(&assets, &moved).unwrap();
    symlink(&moved, &assets);

    let err = f
        .store
        .attachment_path(&f.project, &owner, &id(8))
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::AttachmentNotFound { .. }),
        "{err:?}"
    );

    let err = f
        .store
        .add_attachment(&f.project, &owner, input(&id(9), "b.png", png()), at(6))
        .unwrap_err();
    assert!(matches!(err, AgboardError::FileError { .. }), "{err:?}");
    assert!(!moved.join(format!("{}.png", id(9))).exists());

    let err = f
        .store
        .delete_attachment(&f.project, &owner, &id(8), at(6))
        .unwrap_err();
    assert!(matches!(err, AgboardError::FileError { .. }), "{err:?}");
    assert!(moved.join(format!("{}.png", id(8))).is_file());
}

#[test]
fn a_symbolic_link_in_place_of_an_image_file_is_refused_for_reads() {
    let f = fixture();
    let task = f.task();
    let owner = AttachmentOwner::Task(task);
    f.store
        .add_attachment(&f.project, &owner, input(&id(10), "a.png", png()), at(5))
        .unwrap();
    let file = f.task_assets(task).join(format!("{}.png", id(10)));
    let target = f.outside.join("elsewhere.png");
    fs::write(&target, png()).unwrap();
    fs::remove_file(&file).unwrap();
    symlink(&target, &file);

    let err = f
        .store
        .attachment_path(&f.project, &owner, &id(10))
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::AttachmentNotFound { .. }),
        "{err:?}"
    );
}

#[test]
fn archived_and_draft_tasks_refuse_image_changes() {
    let f = fixture();
    let archived = f.task();
    f.store.archive_task(&f.project, archived, at(5)).unwrap();
    let err = f
        .store
        .add_attachment(
            &f.project,
            &AttachmentOwner::Task(archived),
            input(&id(11), "a.png", png()),
            at(6),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::TaskArchived { .. }), "{err:?}");

    let draft = f.task();
    f.store.set_draft(&f.project, draft, true, at(5)).unwrap();
    let err = f
        .store
        .add_attachment(
            &f.project,
            &AttachmentOwner::Task(draft),
            input(&id(12), "a.png", png()),
            at(6),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::TaskIsDraft { .. }), "{err:?}");
}

#[test]
fn deleting_an_image_removes_its_record_and_its_file() {
    let f = fixture();
    let task = f.task();
    let owner = AttachmentOwner::Task(task);
    f.store
        .add_attachment(&f.project, &owner, input(&id(13), "a.png", png()), at(5))
        .unwrap();
    let file = f.task_assets(task).join(format!("{}.png", id(13)));
    assert!(file.is_file());

    f.store
        .delete_attachment(&f.project, &owner, &id(13), at(6))
        .unwrap();

    assert!(!file.exists());
    assert!(
        f.task_json(task)["attachments"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let err = f
        .store
        .attachment_path(&f.project, &owner, &id(13))
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::AttachmentNotFound { .. }),
        "{err:?}"
    );
}

#[cfg(unix)]
fn symlink(target: &Path, link: &Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}
