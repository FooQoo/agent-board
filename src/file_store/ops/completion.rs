//! Automatic completion when every valid acceptance condition is checked.

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::frontmatter;
use super::super::reader;
use super::HistoryKind;
use super::{Transition, lane_end, lock_project, save_task, stamp, transition_event};
use crate::domain::{Column, ProjectId, RunState};
use crate::error::AgboardError;

const AUTO_DONE_REASON: &str = "All acceptance conditions are complete.";

impl FileStore {
    /// Complete every eligible task in every project. Used before the serve
    /// publishes its first snapshot, so existing work is reconciled on startup.
    pub(crate) fn auto_complete_all(&self, now: DateTime<Utc>) -> Result<bool, AgboardError> {
        let mut changed = false;
        for project in self.projects()? {
            changed |= self.auto_complete_project(&project.id, now)?;
        }
        Ok(changed)
    }

    /// Recheck the latest task files while holding the project write lock.
    /// Invalid or ineligible tasks are left alone; moving a task to Done makes
    /// subsequent watch notifications idempotent.
    pub(crate) fn auto_complete_project(
        &self,
        project: &ProjectId,
        now: DateTime<Utc>,
    ) -> Result<bool, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut changed = false;

        for id in reader::task_ids(&project_dir)? {
            let Ok(loaded) = reader::read_task_lenient(shared, project, id) else {
                continue;
            };
            let task = loaded.view;
            if task.assignee != crate::domain::Assignee::Ai
                || task.is_draft
                || task.archived_at.is_some()
                || !matches!(task.task_status, Column::Todo | Column::Doing)
                || task.agent_status == RunState::Pending
                || task.acceptance_error
                || task.acceptance.is_empty()
                || task.acceptance.iter().any(|item| !item.done)
            {
                continue;
            }

            // Re-read under the lock rather than relying on a prior snapshot.
            let Ok(mut task) = reader::read_task_strict(shared, project, id) else {
                continue;
            };
            let text = match reader::read_body(shared, project, id) {
                Ok(text) => text,
                Err(_) => continue,
            };
            let parsed = frontmatter::parse(&text);
            if !parsed.defects.is_empty()
                || parsed.acceptance.is_empty()
                || parsed.acceptance.iter().any(|item| !item.done)
                || task.assignee != crate::domain::Assignee::Ai
                || task.is_draft
                || task.archived_at.is_some()
                || !matches!(task.task_status, Column::Todo | Column::Doing)
                || task.agent_status == RunState::Pending
            {
                continue;
            }

            let at = stamp(now);
            let position = lane_end(shared, project, Column::Done)?;
            let event = transition_event(Transition {
                language: self.history_language(project, &task)?,
                kind: HistoryKind::Lane,
                reason: Some(
                    self.history_language(project, &task)?
                        .text(AUTO_DONE_REASON, "すべての受入条件を達成しました。"),
                ),
                from_task: Some(task.task_status),
                to_task: Column::Done,
                from_agent: Some(task.agent_status),
                to_agent: RunState::Idle,
                at,
            })?;
            if task.agent_status != RunState::Idle {
                task.agent_status_changed_at = at;
            }
            task.task_status = Column::Done;
            task.task_status_changed_at = at;
            task.agent_status = RunState::Idle;
            task.pending_request_id = None;
            task.pending_request = None;
            task.position = position;
            task.updated_at = at;
            task.history.push(event);
            save_task(shared, &project_dir, &task)?;
            changed = true;
        }
        Ok(changed)
    }
}

#[cfg(test)]
mod tests;
