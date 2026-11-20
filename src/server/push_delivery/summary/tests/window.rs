//! Windows across failing projects.

use super::*;

fn task_with_result(
    store: &FileStore,
    project: &ProjectId,
    title: &str,
    when: DateTime<Utc>,
) -> i64 {
    use crate::domain::{Actor, Assignee, NewTask, ResultKind};
    use crate::file_store::ResultInput;
    let task = store
        .create_task(
            project,
            NewTask {
                title: "T".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                draft: None,
            },
            at(0, 0),
        )
        .unwrap()
        .id;
    store
        .add_result(
            project,
            task,
            ResultInput {
                kind: ResultKind::Progress,
                title: Some(title.into()),
                summary: format!("{title}."),
                link: None,
                images: Vec::new(),
                key: None,
            },
            when,
        )
        .unwrap();
    task
}

fn break_task_json(root: &std::path::Path, project: &ProjectId, task: i64) {
    let path = root
        .join("shared/projects")
        .join(project.to_string())
        .join("tasks")
        .join(task.to_string())
        .join("task.json");
    std::fs::write(&path, "{ not json").unwrap();
}

#[test]
fn an_unreadable_task_keeps_the_boundary_of_its_project_until_it_is_readable() {
    let root = tempfile::tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let project = store.create_project("Alpha", at(0, 0)).unwrap().id;
    task_with_result(&store, &project, "Good", at(10, 10));
    let bad = task_with_result(&store, &project, "Hidden", at(10, 20));
    break_task_json(root.path(), &project, bad);

    // The window is not written, and the boundary does not move.
    assert!(record_from_files(&store, &project, at(10, 0), at(11, 0)).is_err());
    assert!(store.summaries(&project).unwrap().is_empty());
    assert!(store.latest_summary_end(&project).is_none());
}

#[tokio::test]
async fn one_broken_project_does_not_block_the_summary_of_another() {
    use run::{Pending, record_all};
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let healthy = store.create_project("Alpha", at(0, 0)).unwrap().id;
    let broken = store.create_project("Beta", at(0, 0)).unwrap().id;
    task_with_result(&store, &healthy, "Fine", at(10, 10));
    let bad = task_with_result(&store, &broken, "Lost", at(10, 20));
    break_task_json(root.path(), &broken, bad);

    let window = Pending {
        floor: at(10, 0),
        to: at(11, 0),
        entrance_up: true,
    };
    let (written, failed) = record_all(
        shared,
        vec![(healthy.clone(), window), (broken.clone(), window)],
    )
    .await
    .unwrap();
    assert_eq!(written.len(), 1);
    assert_eq!(written[0].0, healthy.to_string());
    assert_eq!(written[0].1.results[0].title, "Fine");
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].0, broken);
    assert_eq!(failed[0].1.floor, at(10, 0));
    assert!(store.latest_summary_end(&broken).is_none());
}

#[test]
fn a_project_that_recovers_with_an_empty_window_continues_from_its_end() {
    use run::{Pending, add_new_windows};
    let root = tempfile::tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let project = store.create_project("Alpha", at(0, 0)).unwrap().id;
    // The 10:00-11:00 window failed and was retried at 13:30; its result is after 11:00.
    task_with_result(&store, &project, "Later", at(11, 30));
    assert!(
        record_from_files(&store, &project, at(10, 0), at(11, 0))
            .unwrap()
            .is_none()
    );
    assert!(store.latest_summary_end(&project).is_none());

    let mut resume = std::collections::HashMap::new();
    resume.insert(project.clone(), at(11, 0));
    let shared_window = Pending {
        floor: at(13, 0),
        to: at(14, 0),
        entrance_up: true,
    };
    let mut windows = Vec::new();
    add_new_windows(
        &mut windows,
        shared_window,
        vec![project.clone()],
        &mut resume,
    );
    let (_, w) = &windows[0];
    assert_eq!(w.floor, at(11, 0));
    let summary = record_from_files(&store, &project, w.floor, w.to)
        .unwrap()
        .unwrap();
    assert_eq!(summary.results[0].title, "Later");
}
