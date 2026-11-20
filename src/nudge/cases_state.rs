//! Cases of the state rules over answers, requests, conditions, epics, running tasks, and drafts.

use chrono::{Duration, Utc};

use super::cases::{Case, case};
use super::test_support::{Scenario, progress_with};
use crate::domain::{Column, Draft, RunState};
use crate::progress::{EpicToClose, Progress, ProgressAnswer, ProgressRequest, ProgressTask};

/// The table's only task, for a case to change.
fn task(p: &mut Progress) -> &mut ProgressTask {
    p.epics
        .iter_mut()
        .flat_map(|e| e.tasks.iter_mut())
        .chain(p.unassigned.iter_mut())
        .next()
        .unwrap()
}

fn with(change: impl FnOnce(&mut Progress)) -> Scenario {
    let mut p = progress_with(false, &[]);
    change(&mut p);
    Scenario::state(p)
}

fn doing(p: &mut Progress, running: bool) {
    let t = task(p);
    t.task_status = Column::Doing;
    t.agent_status = if running {
        RunState::Running
    } else {
        RunState::Idle
    };
}

fn running_since(minutes: i64) -> Scenario {
    with(|p| {
        doing(p, true);
        task(p).last_activity_at = Some(Utc::now() - Duration::minutes(minutes));
    })
}

fn with_draft(lane: Column, draft: Option<Draft>) -> Scenario {
    with(|p| {
        let t = task(p);
        t.draft = draft;
        t.task_status = lane;
    })
}

fn final_with(done: usize, has_final: bool) -> Scenario {
    with(|p| {
        doing(p, true);
        let t = task(p);
        t.has_final_result = has_final;
        t.acceptance.done = done;
        t.acceptance.total = 2;
    })
}

fn epic(path: &str) -> EpicToClose {
    EpicToClose {
        id: "E1".into(),
        name: "E".into(),
        document_path: path.into(),
    }
}

pub fn all() -> Vec<Case> {
    let at = Utc::now();
    vec![
        case(
            "answer",
            "an answer not taken in",
            true,
            with(|p| {
                p.answers.push(ProgressAnswer {
                    id: "Q-1".into(),
                    title: "t".into(),
                    tasks: vec![],
                    choice_id: None,
                    choice_label: None,
                    text: None,
                    answered_at: at,
                    image_paths: Vec::new(),
                })
            }),
        ),
        case("answer", "no answer", false, with(|_| {})),
        case(
            "request",
            "an open request",
            true,
            with(|p| {
                p.requests.push(ProgressRequest {
                    id: "Q-2".into(),
                    created_at: at,
                    title: "t".into(),
                })
            }),
        ),
        case("request", "no request", false, with(|_| {})),
        case(
            "conditions",
            "a final result and conditions left",
            true,
            final_with(1, true),
        ),
        case(
            "conditions",
            "all conditions done",
            false,
            final_with(2, true),
        ),
        case(
            "conditions",
            "no final result yet",
            false,
            final_with(0, false),
        ),
        case(
            "epic-close",
            "all tasks done with an unchecked condition",
            true,
            with(|p| p.epics_to_close.push(epic("/tmp/EPIC.md"))),
        ),
        case("epic-close", "no epic to close", false, with(|_| {})),
        case(
            "stale-running",
            "running for an hour with no history",
            true,
            running_since(60),
        ),
        case(
            "stale-running",
            "running with a recent entry",
            false,
            running_since(5),
        ),
        case(
            "stale-running",
            "an idle task",
            false,
            with(|p| doing(p, false)),
        ),
        case(
            "next-task",
            "a next task and nothing running",
            true,
            with(|p| {
                let id = task(p).id;
                p.next_tasks.push(crate::progress::NextTask {
                    id,
                    title: "T".into(),
                    epic_id: None,
                    task_path: "p".into(),
                    why: crate::progress::NextReason::NextInEpic,
                });
            }),
        ),
        case("next-task", "no next task", false, with(|_| {})),
        case(
            "next-task",
            "a task is running",
            false,
            with(|p| {
                doing(p, true);
                let id = task(p).id;
                p.next_tasks.push(crate::progress::NextTask {
                    id,
                    title: "T".into(),
                    epic_id: None,
                    task_path: "p".into(),
                    why: crate::progress::NextReason::Resume,
                });
            }),
        ),
        case(
            "draft-moved",
            "an AI draft in Doing",
            true,
            with_draft(Column::Doing, Some(Draft::Ai)),
        ),
        case(
            "draft-moved",
            "an AI draft in Todo",
            false,
            with_draft(Column::Todo, Some(Draft::Ai)),
        ),
        case(
            "draft-moved",
            "a person's draft in Doing",
            false,
            with_draft(Column::Doing, Some(Draft::Human)),
        ),
        case(
            "drafts",
            "an AI draft with no open question",
            true,
            with_draft(Column::Todo, Some(Draft::Ai)),
        ),
        case(
            "drafts",
            "an AI draft in Doing",
            true,
            with_draft(Column::Doing, Some(Draft::Ai)),
        ),
        case(
            "drafts",
            "a task that is no draft",
            false,
            with_draft(Column::Todo, None),
        ),
    ]
}
