//! Archiving and restoring tasks.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::domain::{Changed, Column, ProjectId, RunState};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::model::TaskView;
use crate::file_store::reader;

use super::super::{
    HistoryKind, Transition, lane_end, lock_project, save_task, stamp, transition_event,
};
use super::view;

const ARCHIVE_REASON: &str = "Archived by user.";
const RESTORE_REASON: &str = "Restored by user.";

impl FileStore {
    /// Archive a task. Its lane and position stay as they are, and its agent
    /// state returns to idle with its request released.
    pub fn archive_task(
        &self,
        project: &ProjectId,
        id: i64,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        let old_agent = task.agent_status;
        let event = transition_event(Transition {
            language: self.history_language(project, &task)?,
            kind: HistoryKind::Archive,
            reason: Some(
                self.history_language(project, &task)?
                    .text(ARCHIVE_REASON, "ユーザーがアーカイブしました。"),
            ),
            from_task: Some(task.task_status),
            to_task: task.task_status,
            from_agent: Some(old_agent),
            to_agent: RunState::Idle,
            at,
        })?;
        task.archived_at = Some(at);
        task.agent_status = RunState::Idle;
        task.pending_request_id = None;
        task.pending_request = None;
        task.updated_at = at;
        if old_agent != RunState::Idle {
            task.agent_status_changed_at = at;
        }
        task.history.push(event);
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }

    /// Restore an archived task to the end of its lane.
    pub fn restore_task(
        &self,
        project: &ProjectId,
        id: i64,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_none() {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        let position = lane_end(shared, project, task.task_status)?;
        let event = transition_event(Transition {
            language: self.history_language(project, &task)?,
            kind: HistoryKind::Restore,
            reason: Some(
                self.history_language(project, &task)?
                    .text(RESTORE_REASON, "ユーザーが復元しました。"),
            ),
            from_task: Some(task.task_status),
            to_task: task.task_status,
            from_agent: Some(RunState::Idle),
            to_agent: RunState::Idle,
            at,
        })?;
        task.archived_at = None;
        task.position = position;
        task.updated_at = at;
        task.history.push(event);
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }
}

/// The result of a bulk archive: every target as it is now, and how many this
/// call archived. A resend of a finished bulk archive archives nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDoneResult {
    pub tasks: Vec<TaskView>,
    pub archived_count: usize,
}

impl FileStore {
    /// Archive every target that is done, under the write lock. The IDs must be
    /// a non-empty list of unique positive integers. Each target must exist and
    /// be either archived already (a resend) or in Done; otherwise nothing is
    /// archived and the call is `archive_targets_changed`.
    pub fn archive_done(
        &self,
        project: &ProjectId,
        ids: &[i64],
        now: DateTime<Utc>,
    ) -> Result<Changed<ArchiveDoneResult>, AgboardError> {
        if ids.is_empty()
            || ids.iter().any(|id| *id <= 0)
            || ids.iter().collect::<HashSet<_>>().len() != ids.len()
        {
            return Err(AgboardError::InvalidValue {
                field: "ids".into(),
                reason: "IDs must be a non-empty list of unique positive integers.".into(),
            });
        }
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut targets = Vec::with_capacity(ids.len());
        for id in ids {
            let task = match reader::read_task_strict(shared, project, *id) {
                Ok(task) => task,
                Err(AgboardError::TaskNotFound { .. }) => {
                    return Err(AgboardError::ArchiveTargetsChanged);
                }
                Err(other) => return Err(other),
            };
            if task.archived_at.is_none() && task.task_status != Column::Done {
                return Err(AgboardError::ArchiveTargetsChanged);
            }
            targets.push(task);
        }
        let at = stamp(now);
        let mut archived_count = 0;
        for mut task in targets {
            if task.archived_at.is_some() {
                continue;
            }
            let old_agent = task.agent_status;
            let event = transition_event(Transition {
                language: self.history_language(project, &task)?,
                kind: HistoryKind::Archive,
                reason: Some(
                    self.history_language(project, &task)?
                        .text(ARCHIVE_REASON, "ユーザーがアーカイブしました。"),
                ),
                from_task: Some(task.task_status),
                to_task: task.task_status,
                from_agent: Some(old_agent),
                to_agent: RunState::Idle,
                at,
            })?;
            task.archived_at = Some(at);
            task.agent_status = RunState::Idle;
            task.pending_request_id = None;
            task.pending_request = None;
            task.updated_at = at;
            if old_agent != RunState::Idle {
                task.agent_status_changed_at = at;
            }
            task.history.push(event);
            save_task(shared, &project_dir, &task)?;
            archived_count += 1;
        }
        let tasks = ids
            .iter()
            .map(|id| view(shared, project, *id))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Changed {
            value: ArchiveDoneResult {
                tasks,
                archived_count,
            },
            changed: archived_count > 0,
        })
    }
}
