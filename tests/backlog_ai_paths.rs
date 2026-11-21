//! No AI path takes a card out of the Backlog, and the surfaces an agent reads (the progress
//! table's `nextTasks`, the hook reminders) use one start condition. Every test uses a
//! temporary data area.

mod common;

#[path = "support/qa.rs"]
mod qa;

use std::path::PathBuf;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId, RunState};
use agent_board::file_store::FileStore;
use chrono::{TimeZone, Utc};

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 21, 0, 0, 0).unwrap()
}

struct Fx {
    _root: tempfile::TempDir,
    shared: PathBuf,
    store: FileStore,
    project: ProjectId,
}

fn fx() -> Fx {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Alpha", now()).unwrap().id;
    Fx {
        _root: root,
        shared,
        store,
        project,
    }
}

fn new_task(title: &str) -> NewTask {
    NewTask {
        title: title.into(),
        description: String::new(),
        assignee: Assignee::Ai,
        actor: Actor::Ai,
        draft: None,
    }
}

impl Fx {
    fn plan(&self, title: &str) -> i64 {
        self.store
            .create_task_in_backlog(&self.project, new_task(title), now())
            .unwrap()
            .id
    }

    fn todo(&self, title: &str) -> i64 {
        self.store
            .create_task(&self.project, new_task(title), now())
            .unwrap()
            .id
    }

    fn next(&self) -> Vec<i64> {
        let snapshot = self.store.board(&self.project).unwrap();
        let table = agent_board::progress::build(&snapshot, &self.shared, now());
        table.next_tasks.iter().map(|t| t.id).collect()
    }

    fn start_reminders(&self) -> Vec<Option<i64>> {
        let snapshot = self.store.board(&self.project).unwrap();
        let table = agent_board::progress::build(&snapshot, &self.shared, now());
        agent_board::nudge::state_reminders(&table, now())
            .into_iter()
            .filter(|r| r.rule == "next-task")
            .map(|r| r.task_id)
            .collect()
    }

    fn lane(&self, id: i64) -> Column {
        self.store.task(&self.project, id).unwrap().task_status
    }
}

fn ai(reason: &str) -> ChangeContext {
    ChangeContext {
        actor: Actor::Ai,
        reason: reason.into(),
    }
}

#[test]
fn an_answered_backlog_card_stays_out_of_candidates_and_reminders_until_it_is_sent() {
    let f = fx();
    let plan = f.plan("Plan");
    let question = qa::ask(&f.store, &f.project, &[plan], "Which way?", &[]);
    assert!(f.next().is_empty());

    qa::answer(&f.store, &f.project, &question.id, None, Some("Plan A."));
    // Every question is answered, and the card is still a plan.
    assert_eq!(f.lane(plan), Column::Backlog);
    assert!(f.next().is_empty(), "an answer does not make a plan ready");
    assert!(f.start_reminders().is_empty(), "no start reminder either");

    // The same card, once a person sends it, is a candidate and a reminder.
    f.store
        .send_task(&f.project, plan, Actor::Human, false, now())
        .unwrap();
    assert_eq!(f.next(), vec![plan]);
    assert_eq!(f.start_reminders(), vec![Some(plan)]);
}

#[test]
fn a_todo_task_is_delivered_after_its_questions_are_answered_without_a_send() {
    let f = fx();
    let id = f.todo("Execute");
    let question = qa::ask(&f.store, &f.project, &[id], "Which way?", &[]);
    assert!(f.next().is_empty(), "an open question holds the task back");
    qa::answer(&f.store, &f.project, &question.id, None, Some("Plan A."));
    assert_eq!(f.next(), vec![id], "the answer alone releases it");
}

#[test]
fn an_ai_cannot_take_a_card_out_of_the_backlog_by_any_command() {
    let f = fx();
    let plan = f.plan("Plan");
    let other = f.plan("Other");

    for to in [Column::Todo, Column::Doing, Column::Done] {
        let moved = f
            .store
            .move_work_task(&f.project, plan, to, ai("go"), now());
        assert_eq!(moved.unwrap_err().code(), "task_in_backlog", "{to:?}");
    }
    for state in [RunState::Running, RunState::Idle] {
        let set = f
            .store
            .set_agent_status(&f.project, plan, state, ai("go"), now());
        assert_eq!(set.unwrap_err().code(), "task_in_backlog", "{state:?}");
    }
    let sent = f.store.send_task(&f.project, plan, Actor::Ai, true, now());
    assert_eq!(sent.unwrap_err().code(), "human_only");
    assert_eq!(f.lane(plan), Column::Backlog);
    assert_eq!(f.lane(other), Column::Backlog);
    assert!(f.next().is_empty());
}
