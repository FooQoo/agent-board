//! Creating a task.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};

use crate::domain::{Column, NewTask, ProjectId, RunState, validate_title};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::history::{ParseMode, compose_task, parse_task};
use crate::file_store::history_language::HistoryLanguage;
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::{TaskFile, TaskMetadata, TaskView};
use crate::file_store::onboarding_model::OnboardingSample;
use crate::file_store::reader;
use crate::file_store::validate;

use super::super::{
    HistoryKind, Transition, lane_end, lock_project, save_project, stamp, transition_event,
};
use super::{normalize_description, view};

/// Write a new task folder: `task.json` and `TASK.md` go into a temporary
/// folder that is renamed into place. A failure removes the temporary folder.
fn write_new_task(
    shared: &Path,
    project_dir: &Path,
    task: &TaskFile,
    body: &str,
) -> Result<(), AgboardError> {
    let tasks = layout::tasks_dir(project_dir);
    let target = layout::task_dir(project_dir, task.id);
    let label = layout::shared_label(shared, &target);
    if target.exists() {
        return Err(io::write_error(&label, "the task folder already exists"));
    }
    let temp = tasks.join(format!(
        ".new-{}",
        io::random_hex(16).map_err(|e| io::write_error(&label, e))?
    ));
    fs::create_dir(&temp).map_err(|e| io::write_error(&label, e))?;
    let result = (|| -> Result<(), AgboardError> {
        let parsed = parse_task(body, ParseMode::NewInput);
        if let Some(defect) = parsed.history_defects.first() {
            return Err(AgboardError::FileInvalid {
                file: format!("{label}/TASK.md"),
                field: defect.field.clone(),
                reason: defect.reason.clone(),
            });
        }
        let body = compose_task(body, &parsed.body, None, &task.history).map_err(|defect| {
            AgboardError::FileInvalid {
                file: format!("{label}/TASK.md"),
                field: defect.field,
                reason: defect.reason,
            }
        })?;
        io::write_json(
            &layout::task_json(&temp),
            &TaskMetadata::from(task),
            &format!("{label}/task.json"),
        )?;
        io::write_atomic(
            &layout::task_md(&temp),
            body.as_bytes(),
            &format!("{label}/TASK.md"),
        )?;
        fs::rename(&temp, &target).map_err(|e| io::write_error(&label, e))?;
        io::sync_dir(&tasks).map_err(|e| io::write_error(&label, e))
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&temp);
    }
    result
}

impl FileStore {
    /// Create a task in the To Do lane at the end. The number is reserved in
    /// `project.json` before the task folder is written, so a failed write
    /// leaves a gap in the numbers and never reuses one. A body that is not
    /// given (empty or blank) gets the TASK.md template.
    pub fn create_task(
        &self,
        project: &ProjectId,
        new: NewTask,
        now: DateTime<Utc>,
    ) -> Result<TaskView, AgboardError> {
        self.create_task_with_identity(project, new, now, None)
    }

    /// [`Self::create_task`] for the first-run guide: the card is written with its
    /// sample identity in the same file, so it never exists without one.
    pub(crate) fn create_task_with_identity(
        &self,
        project: &ProjectId,
        new: NewTask,
        now: DateTime<Utc>,
        identity: Option<OnboardingSample>,
    ) -> Result<TaskView, AgboardError> {
        let title = validate_title(&new.title)?;
        let description = normalize_description(&new.description)?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut file = reader::read_project_file(shared, project)?;
        let id = file.next_task_id;
        let body = if description.trim().is_empty() {
            validate::task_template()
        } else {
            description
        };
        let label = layout::shared_label(
            shared,
            &layout::task_md(&layout::task_dir(&project_dir, id)),
        );
        validate::ensure_task_body(&body, &label)?;
        let position = lane_end(shared, project, Column::Todo)?;
        let at = stamp(now);
        let language = self
            .history_language
            .unwrap_or_else(|| HistoryLanguage::infer(&body, &title));
        let task = TaskFile {
            format_version: layout::FORMAT_VERSION,
            id,
            title,
            assignee: new.assignee,
            epic_id: None,
            task_status: Column::Todo,
            agent_status: RunState::Idle,
            position,
            is_draft: new.is_draft,
            archived_at: None,
            pending_request_id: None,
            pending_request: None,
            request_answers: Vec::new(),
            created_at: at,
            updated_at: at,
            agent_status_changed_at: at,
            task_status_changed_at: at,
            attachments: Vec::new(),
            simple_request: None,
            onboarding_sample: identity,
            history: vec![transition_event(Transition {
                language,
                kind: HistoryKind::Created,
                reason: None,
                from_task: None,
                to_task: Column::Todo,
                from_agent: None,
                to_agent: RunState::Idle,
                at,
            })?],
        };
        file.next_task_id = id
            .checked_add(1)
            .ok_or_else(|| io::write_error("project.json", "The task number overflowed."))?;
        save_project(shared, &project_dir, &file)?;
        write_new_task(shared, &project_dir, &task, &body)?;
        view(shared, project, id)
    }
}
