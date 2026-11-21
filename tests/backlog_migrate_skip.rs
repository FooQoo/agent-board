//! The Backlog conversion skips a task folder that has no task.json, so one stray folder
//! does not block every write to the project.

use agent_board::domain::{Actor, Assignee, NewTask};
use agent_board::file_store::FileStore;
use chrono::{TimeZone, Utc};

#[test]
fn a_task_folder_without_task_json_does_not_block_writes() {
    let now = Utc.with_ymd_and_hms(2026, 11, 21, 0, 0, 0).unwrap();
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Alpha", now).unwrap().id;
    let project_dir = shared.join("projects").join(project.as_str());
    let _ = std::fs::remove_file(project_dir.join(".internal").join("backlog-migrated"));
    let stray = project_dir.join("tasks").join("99");
    std::fs::create_dir_all(&stray).unwrap();
    std::fs::write(stray.join("TASK.md"), "---\nacceptance: []\n---\n").unwrap();

    let created = store.create_task(
        &project,
        NewTask {
            title: "Card".into(),
            description: String::new(),
            assignee: Assignee::Ai,
            actor: Actor::Human,
            draft: None,
        },
        now,
    );

    assert!(created.is_ok(), "{created:?}");
}
