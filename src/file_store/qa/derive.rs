//! Deriving "waiting for a person" from the questions a task refers to.

use super::model::{Message, question_number};
use super::store::QaIndex;
use super::view::{QuestionView, RequestView};
use crate::domain::{Assignee, Column, RunState};
use crate::file_store::model::{Problem, TaskView};

/// Whether the shown run state of a task is `pending`: an AI task in Todo or Doing, not
/// archived, that waits for a person.
pub fn shows_pending(task: &TaskView, index: &QaIndex) -> bool {
    task.assignee == Assignee::Ai
        && matches!(task.task_status, Column::Todo | Column::Doing)
        && task.archived_at.is_none()
        && index.is_waiting(&task.question_ids, task.questions_error)
}

/// Lay the questions over a task read from its files: the open questions, the shown run state,
/// and the first open question as the pending request.
pub fn apply(task: &mut TaskView, index: &QaIndex) {
    let open = index.open_among(&task.question_ids);
    task.open_question_ids = open.iter().map(|q| q.id.clone()).collect();
    task.pending_request_id = None;
    task.pending_reason = None;
    task.pending_choices = Vec::new();
    if shows_pending(task, index) {
        task.agent_status = RunState::Pending;
        if let Some(question) = open.first() {
            task.pending_request_id = Some(question.id.clone());
            task.pending_reason = Some(question.body.clone());
            task.pending_choices = question.choices.clone();
        }
    }
}

/// The notes about references that name no question. When a message file is broken the
/// reference may name one of them, so it is reported and the task waits.
pub fn missing_references(
    tasks: &[TaskView],
    index: &QaIndex,
    label: impl Fn(i64) -> String,
) -> Vec<Problem> {
    let mut problems = Vec::new();
    for task in tasks {
        for id in &task.question_ids {
            let reason = match index.find(id) {
                Some(Message::Question(_)) => continue,
                Some(Message::Request(_)) => format!("{id} is a request, not a question."),
                None if index.broken => {
                    format!("{id} names no readable question; a message file is broken.")
                }
                None => format!("{id} names no question."),
            };
            problems.push(Problem {
                file: label(task.id),
                field: "questions".into(),
                reason,
            });
        }
    }
    problems
}

/// Every question of a project in ID order, with the unarchived tasks that refer to it.
pub fn question_views(index: &QaIndex, tasks: &[TaskView]) -> Vec<QuestionView> {
    let mut views: Vec<QuestionView> = index
        .questions()
        .map(|question| {
            let referenced_by = tasks
                .iter()
                .filter(|t| t.archived_at.is_none() && t.question_ids.contains(&question.id))
                .map(|t| t.id)
                .collect();
            QuestionView::of(question, referenced_by)
        })
        .collect();
    views.sort_by_key(|view| question_number(&view.id).unwrap_or(i64::MAX));
    views
}

/// Every request of a project in ID order.
pub fn request_views(index: &QaIndex) -> Vec<RequestView> {
    let mut views: Vec<RequestView> = index.requests().map(RequestView::of).collect();
    views.sort_by_key(|view| view.number());
    views
}
