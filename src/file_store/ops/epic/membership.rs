//! Deleting an epic and setting the epic of a task.

use std::fs;

use chrono::{DateTime, Utc};

use crate::domain::{Actor, Changed, ProjectId};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::TaskView;
use crate::file_store::reader;
use crate::file_store::validate::EpicId;

use super::super::{
    HistoryKind, Transition, ensure_ai_task_not_done, lock_project, save_task, stamp,
    transition_event,
};
use super::read_epic_file;

impl FileStore {
    /// Delete an epic folder. Refused with `epic_in_use` while any task, archived
    /// ones included, names the epic. The folder is renamed out of the way first,
    /// then removed. A folder whose `epic.json` is broken can still be deleted.
    pub fn delete_epic(&self, project: &ProjectId, id: &EpicId) -> Result<(), AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let dir = layout::epic_dir(&project_dir, id);
        if !dir.is_dir() {
            return Err(AgboardError::EpicNotFound { id: id.to_string() });
        }
        for task_id in reader::task_ids(&project_dir)? {
            let task = reader::read_task_strict(shared, project, task_id)?;
            if task.epic_id.as_deref() == Some(id.as_str()) {
                return Err(AgboardError::EpicInUse { id: id.to_string() });
            }
        }
        let epics = layout::epics_dir(&project_dir);
        let label = layout::shared_label(shared, &dir);
        let trash = epics.join(format!(
            ".deleting-{}",
            io::random_hex(16).map_err(|e| io::write_error(&label, e))?
        ));
        fs::rename(&dir, &trash).map_err(|e| io::write_error(&label, e))?;
        io::sync_dir(&epics).map_err(|e| io::write_error(&label, e))?;
        fs::remove_dir_all(&trash).map_err(|e| io::write_error(&label, e))
    }

    /// Set (`Some`) or clear (`None`) the epic of a task. Only a real change
    /// adds an epic history event and moves `updatedAt`. An AI cannot change an
    /// archived or draft task; a person can.
    pub fn set_task_epic(
        &self,
        project: &ProjectId,
        task_id: i64,
        epic: Option<&EpicId>,
        actor: Actor,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, task_id)?;
        if matches!(actor, Actor::Ai) {
            if task.archived_at.is_some() {
                return Err(AgboardError::TaskArchived { id: task_id });
            }
            if task.is_draft {
                return Err(AgboardError::TaskIsDraft { id: task_id });
            }
        }
        ensure_ai_task_not_done(&task, actor)?;
        if let Some(id) = epic {
            read_epic_file(shared, project, id)?;
        }
        let next = epic.map(|id| id.to_string());
        if task.epic_id == next {
            return Ok(Changed {
                value: reader::read_task_locked(shared, project, task_id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        let language = self.history_language(project, &task)?;
        let english = format!(
            "Changed epic from {} to {}.",
            task.epic_id.as_deref().unwrap_or("none"),
            next.as_deref().unwrap_or("none")
        );
        let japanese = format!(
            "所属エピックを{}から{}に変更しました。",
            task.epic_id.as_deref().unwrap_or("なし"),
            next.as_deref().unwrap_or("なし")
        );
        let reason = language.text(&english, &japanese);
        let event = transition_event(Transition {
            language: self.history_language(project, &task)?,
            kind: HistoryKind::Epic,
            reason: Some(reason),
            from_task: Some(task.task_status),
            to_task: task.task_status,
            from_agent: Some(task.agent_status),
            to_agent: task.agent_status,
            at,
        })?;
        task.history.push(event);
        task.epic_id = next;
        task.updated_at = at;
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: reader::read_task_locked(shared, project, task_id)?,
            changed: true,
        })
    }
}
