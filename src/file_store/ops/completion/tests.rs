use std::path::PathBuf;

use chrono::{TimeZone, Utc};

use crate::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId, RunState};
use crate::file_store::FileStore;

fn at(day: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, day, 0, 0, 0).unwrap()
}

const OPEN: &str = "---\nacceptance:\n  - id: AC-1\n    text: First\n    done: true\n  - id: AC-2\n    text: Second\n    done: false\n---\n\nWork.\n";
const COMPLETE: &str = "---\nacceptance:\n  - id: AC-1\n    text: First\n    done: true\n  - id: AC-2\n    text: Second\n    done: true\n---\n\nWork.\n";

struct Fixture {
    _root: tempfile::TempDir,
    store: FileStore,
    project: ProjectId,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let store = FileStore::open(&root.path().join("shared"));
        let project = store.create_project("Alpha", at(1)).unwrap().id;
        Self {
            _root: root,
            store,
            project,
        }
    }

    fn task(&self, name: &str, assignee: Assignee, body: &str, draft: bool) -> i64 {
        self.store
            .create_task(
                &self.project,
                NewTask {
                    title: name.into(),
                    description: body.into(),
                    assignee,
                    actor: Actor::Ai,
                    is_draft: draft,
                },
                at(1),
            )
            .unwrap()
            .id
    }

    fn path(&self, id: i64) -> PathBuf {
        self.store
            .shared_dir()
            .join("projects")
            .join(self.project.as_str())
            .join("tasks")
            .join(id.to_string())
            .join("TASK.md")
    }

    fn replace_description(&self, id: i64, description: &str) {
        let path = self.path(id);
        let current = std::fs::read_to_string(&path).unwrap();
        let stored = super::super::super::history::parse_task(
            &current,
            super::super::super::history::ParseMode::Stored,
        );
        let input = super::super::super::history::parse_task(
            description,
            super::super::super::history::ParseMode::NewInput,
        );
        let next = super::super::super::history::compose_task(
            description,
            &input.body,
            Some(&input.acceptance),
            &stored.history,
        )
        .unwrap();
        std::fs::write(path, next).unwrap();
    }
}

#[test]
fn automatic_completion_uses_the_body_language() {
    let f = Fixture::new();
    let id = f.task(
        "Japanese",
        Assignee::Ai,
        &format!("{COMPLETE}\n日本語の本文。"),
        false,
    );
    assert!(f.store.auto_complete_all(at(2)).unwrap());
    assert_eq!(
        f.store
            .task(&f.project, id)
            .unwrap()
            .history
            .last()
            .unwrap()
            .reason,
        "すべての受入条件を達成しました。"
    );
}

#[test]
fn completed_ai_todo_moves_once_and_records_a_reasoned_lane_event() {
    let f = Fixture::new();
    let id = f.task("Complete", Assignee::Ai, COMPLETE, false);

    assert!(f.store.auto_complete_all(at(2)).unwrap());
    assert!(!f.store.auto_complete_all(at(3)).unwrap());

    let task = f.store.task(&f.project, id).unwrap();
    assert_eq!(task.task_status, Column::Done);
    assert_eq!(task.agent_status, RunState::Idle);
    let completed: Vec<_> = task
        .history
        .iter()
        .filter(|e| e.reason == super::AUTO_DONE_REASON)
        .collect();
    assert_eq!(completed.len(), 1);
    assert!(!completed[0].reason.is_empty());
}

#[test]
fn only_valid_nonempty_fully_done_ai_conditions_are_eligible() {
    let f = Fixture::new();
    let open = f.task("Open", Assignee::Ai, OPEN, false);
    let human = f.task("Human", Assignee::Human, COMPLETE, false);
    let draft = f.task("Draft", Assignee::Ai, COMPLETE, true);
    let none = f.task(
        "None",
        Assignee::Ai,
        "---\nacceptance: []\n---\n\nWork.\n",
        false,
    );
    let invalid = f.task("Invalid", Assignee::Ai, OPEN, false);
    let valid = std::fs::read_to_string(f.path(invalid)).unwrap();
    let (_, history) = valid.split_once("history:").unwrap();
    std::fs::write(
        f.path(invalid),
        format!("---\nacceptance: nope\nhistory:{history}"),
    )
    .unwrap();

    f.store.auto_complete_all(at(2)).unwrap();

    for id in [open, human, draft, none, invalid] {
        assert_ne!(
            f.store.task(&f.project, id).unwrap().task_status,
            Column::Done
        );
    }
}

#[test]
fn pending_is_left_alone_then_answered_task_is_reconsidered() {
    let f = Fixture::new();
    let id = f.task("Pending", Assignee::Ai, COMPLETE, false);
    f.store
        .move_work_task(
            &f.project,
            id,
            Column::Doing,
            ChangeContext {
                actor: Actor::Ai,
                reason: "Start".into(),
            },
            at(2),
        )
        .unwrap();
    let pending = f
        .store
        .request_decision(
            &f.project,
            id,
            Actor::Ai,
            "Question",
            vec![
                crate::file_store::model::Choice {
                    id: "a".into(),
                    label: "A".into(),
                },
                crate::file_store::model::Choice {
                    id: "b".into(),
                    label: "B".into(),
                },
            ],
            at(3),
        )
        .unwrap()
        .value;

    f.store.auto_complete_all(at(4)).unwrap();
    assert_eq!(
        f.store.task(&f.project, id).unwrap().agent_status,
        RunState::Pending
    );
    f.store
        .answer_request(
            &f.project,
            id,
            pending.pending_request_id.as_deref().unwrap(),
            crate::file_store::Answer {
                actor: Actor::Human,
                choice_id: Some("a".into()),
                text: None,
            },
            at(5),
        )
        .unwrap();
    f.store.auto_complete_all(at(6)).unwrap();

    let task = f.store.task(&f.project, id).unwrap();
    assert_eq!(task.task_status, Column::Done);
    assert_eq!(task.agent_status, RunState::Idle);
}

#[test]
fn direct_task_file_updates_are_rechecked_and_existing_done_is_not_reopened() {
    let f = Fixture::new();
    let id = f.task("Edited externally", Assignee::Ai, OPEN, false);
    f.replace_description(id, COMPLETE);
    assert!(f.store.auto_complete_all(at(2)).unwrap());

    f.replace_description(id, OPEN);
    assert!(!f.store.auto_complete_all(at(3)).unwrap());
    assert_eq!(
        f.store.task(&f.project, id).unwrap().task_status,
        Column::Done
    );
}
