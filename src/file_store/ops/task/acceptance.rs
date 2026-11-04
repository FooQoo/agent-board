//! A person checking or unchecking one acceptance condition from the board
//! or the mobile monitor.

use chrono::{DateTime, Utc};

use crate::domain::{Changed, ProjectId};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::history::{ParseMode, parse_task};
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::TaskView;
use crate::file_store::reader;

use super::super::{
    HistoryKind, Transition, lock_project, save_task_with_markdown, stamp, transition_event,
    write_parts,
};
use super::view;

impl FileStore {
    /// Set the acceptance condition `condition` of a task to `done`, as a
    /// person. The latest TASK.md is read under the project lock and only that
    /// condition changes, so the person's choice wins over any change made
    /// since they loaded the task, and nothing else is lost. A condition that
    /// already has the value changes nothing. An archived task is refused; a
    /// task in Done stays there. When every condition of an eligible AI task is
    /// checked, the watcher then moves it to Done as it does for an agent.
    pub fn set_acceptance_done(
        &self,
        project: &ProjectId,
        id: i64,
        condition: &str,
        done: bool,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        let md_path = layout::task_md(&layout::task_dir(&project_dir, id));
        let label = layout::shared_label(shared, &md_path);
        let parsed = parse_task(&io::read_text(&md_path, &label)?, ParseMode::Stored);
        if let Some(defect) = parsed.acceptance_defects.first() {
            return Err(AgboardError::FileInvalid {
                file: label,
                field: defect.field.clone(),
                reason: defect.reason.clone(),
            });
        }
        let mut items = parsed.acceptance;
        let Some(item) = items.iter_mut().find(|item| item.id == condition) else {
            return Err(AgboardError::InvalidArgument {
                message: format!("Task #{id} has no acceptance condition {condition}."),
                command: None,
            });
        };
        if item.done == done {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        item.done = done;
        let at = stamp(now);
        let language = self.history_language(project, &task)?;
        let (english, japanese) = if done {
            (
                format!("A person marked {condition} as met."),
                format!("人が{condition}を達成にしました。"),
            )
        } else {
            (
                format!("A person marked {condition} as not met."),
                format!("人が{condition}を未達成に戻しました。"),
            )
        };
        let event = transition_event(Transition {
            kind: HistoryKind::Acceptance,
            language,
            reason: Some(language.text(&english, &japanese)),
            from_task: Some(task.task_status),
            to_task: task.task_status,
            from_agent: Some(task.agent_status),
            to_agent: task.agent_status,
            at,
        })?;
        task.history.push(event);
        let markdown = write_parts(shared, &project_dir, &mut task, None, Some(&items))?;
        task.updated_at = at;
        save_task_with_markdown(shared, &project_dir, &task, markdown.as_deref())?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }
}
