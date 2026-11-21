//! A draft save answers with the TASK.md text it committed, finalization event included.

use agent_board::domain::{Actor, Assignee, Draft, NewTask};
use agent_board::file_store::FileStore;
use chrono::{TimeZone, Utc};

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 21, 0, 0, 0).unwrap()
}

#[test]
fn finalizing_a_human_draft_answers_with_the_committed_file_text() {
    for new_text in [Some("## 作業内容\n\nRead this.\n"), None] {
        let root = tempfile::tempdir().unwrap();
        let shared = root.path().join("shared");
        let store = FileStore::open(&shared);
        let project = store.create_project("Alpha", now()).unwrap().id;
        let id = store
            .create_task(
                &project,
                NewTask {
                    title: "Plan".into(),
                    description: "## 作業内容\n\nFirst.\n".into(),
                    assignee: Assignee::Ai,
                    actor: Actor::Human,
                    draft: None,
                },
                now(),
            )
            .unwrap()
            .id;
        store
            .set_draft(&project, id, Some(Draft::Human), false, now())
            .unwrap();

        let saved = store
            .edit_draft_task(&project, id, None, new_text, true, now())
            .unwrap();

        let path = shared
            .join("projects")
            .join(project.as_str())
            .join("tasks")
            .join(id.to_string())
            .join("TASK.md");
        let committed = std::fs::read_to_string(path).unwrap();
        assert_eq!(saved.value.draft, None);
        assert_eq!(saved.value.description, committed);
        let last = saved
            .value
            .history
            .last()
            .expect("the finalization is recorded");
        assert!(
            committed.contains(&last.reason),
            "the committed file holds the finalization event"
        );
    }
}
