//! Task operations: creation, title and body edits, the draft flag, archive,
//! restore, and deletion of an archived task.

mod archive;
mod create;
mod delete;
mod draft;
mod edit;

use std::path::Path;

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::model::{HistoryRecord, TaskView};
use super::super::reader;
use super::{ensure_ai_task_not_done, lock_project, save_task, stamp};
use crate::domain::{Actor, Changed, Column, ProjectId, normalize_and_validate_description};
use crate::error::AgboardError;

/// The description as it is stored: CRLF folded to LF, and at most 50,000 characters of Markdown body. The
/// frontmatter is not counted, because the editor counts only the body.
fn normalize_description(value: &str) -> Result<String, AgboardError> {
    let normalized = value.replace("\r\n", "\n");
    let body = crate::file_store::frontmatter::parse(&normalized).body;
    normalize_and_validate_description(&body)?;
    Ok(normalized)
}

/// The task's view after a change, read back from the files.
fn view(shared: &Path, project: &ProjectId, id: i64) -> Result<TaskView, AgboardError> {
    reader::read_task_locked(shared, project, id)
}

impl FileStore {
    /// Append an AI work note using the same immutable/draft/archive guards as editing.
    pub fn add_history(
        &self,
        project: &ProjectId,
        id: i64,
        reason: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<TaskView, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        ensure_ai_task_not_done(&task, Actor::Ai)?;
        if task.is_draft {
            return Err(AgboardError::TaskIsDraft { id });
        }
        let language = self.history_language(project, &task)?;
        let fallback = format!(
            "Progress note in {}; agent is {}.",
            task.task_status.label(),
            task.agent_status.as_str()
        );
        let japanese = format!(
            "{}での進捗を記録しました。エージェントは{}です。",
            task.task_status.label(),
            task.agent_status.as_str()
        );
        let reason =
            super::reason_or_default(reason, language.text(&fallback, &japanese).to_owned())?;
        let at = stamp(now);
        task.history.push(HistoryRecord { at, reason });
        task.updated_at = at;
        save_task(shared, &project_dir, &task)?;
        view(shared, project, id)
    }

    /// Put a task in a new place in its own lane: just before `before` in the
    /// order the board shows, or at the end of that order when `before` is
    /// `None` or is not in the lane. The lane is renumbered 1..n, and only the
    /// tasks whose position changed are rewritten. Reordering is not a work
    /// change, so it leaves `updatedAt` and the history alone.
    pub fn reorder_task(
        &self,
        project: &ProjectId,
        id: i64,
        before: Option<i64>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        let lane = task.task_status;
        let mut tasks: Vec<(i64, i64)> = Vec::new();
        for task_id in reader::task_ids(&project_dir)? {
            if let Ok(load) = reader::read_task_lenient(shared, project, task_id) {
                let task = load.view;
                if task.task_status == lane && task.archived_at.is_none() {
                    tasks.push((task.id, task.position));
                }
            }
        }
        // The board shows Done newest first, and the other lanes oldest first.
        tasks.sort_by_key(|&(task_id, position)| (position, task_id));
        let mut order: Vec<i64> = tasks.iter().map(|&(task_id, _)| task_id).collect();
        if lane == Column::Done {
            order.reverse();
        }
        order.retain(|&task_id| task_id != id);
        let at = before
            .and_then(|target| order.iter().position(|&task_id| task_id == target))
            .unwrap_or(order.len());
        order.insert(at, id);
        let count = order.len() as i64;
        let mut changed = false;
        for (index, &task_id) in order.iter().enumerate() {
            let index = index as i64;
            let position = if lane == Column::Done {
                count - index
            } else {
                index + 1
            };
            let current = tasks
                .iter()
                .find(|&&(other, _)| other == task_id)
                .map(|&(_, current)| current);
            if current == Some(position) {
                continue;
            }
            let mut task_file = reader::read_task_strict(shared, project, task_id)?;
            task_file.position = position;
            save_task(shared, &project_dir, &task_file)?;
            changed = true;
        }
        Ok(Changed {
            value: view(shared, project, id)?,
            changed,
        })
    }
}
