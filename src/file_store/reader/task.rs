//! Reading tasks: the lenient snapshot read and the strict reads.

use super::{
    epics::read_epics,
    files::{file_time, parse_task_metadata, problem_of},
    project::project_dir_checked,
};
use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::frontmatter;
use crate::file_store::history::{ParseMode, parse_task};
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::lock::WriteLock;
use crate::file_store::migrate;
use crate::file_store::model::{
    EpicView, Problem, TaskEpic, TaskFile, TaskMetadata, TaskView, current_request,
};
use crate::file_store::transaction;
use crate::file_store::validate;

/// A task that was read leniently: its view and the defects of its text.
pub(crate) struct TaskLoad {
    pub view: TaskView,
    pub problems: Vec<Problem>,
}

/// The task IDs of a project, in ascending order. Only folders with canonical
/// names count; a temporary folder or a stray file is ignored.
pub(crate) fn task_ids(project_dir: &Path) -> Result<Vec<i64>, AgboardError> {
    let tasks = layout::tasks_dir(project_dir);
    if !tasks.is_dir() {
        return Ok(Vec::new());
    }
    let label = layout::project_label(project_dir, &tasks);
    let entries = fs::read_dir(&tasks).map_err(|e| io::read_error(&label, e))?;
    let mut ids = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| io::read_error(&label, e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        if let Some(id) = name.to_str().and_then(layout::parse_task_dir) {
            ids.push(id);
        }
    }
    ids.sort_unstable();
    Ok(ids)
}

/// Read a task for a snapshot. A defect in `task.json` fails the task, and
/// the caller reports it as problems. A defect in TASK.md returns the text.
pub(crate) fn read_task_lenient(
    shared: &Path,
    project_id: &ProjectId,
    task_id: i64,
) -> Result<TaskLoad, Vec<Problem>> {
    let project_dir = layout::project_dir(shared, project_id);
    let dir = layout::task_dir(&project_dir, task_id);
    let json_path = layout::task_json(&dir);
    let json_label = layout::shared_label(shared, &json_path);
    let metadata: TaskMetadata = match io::read_bytes(&json_path, &json_label)
        .and_then(|bytes| parse_task_metadata(&bytes, &json_label))
    {
        Ok(metadata) => metadata,
        Err(error) => return Err(vec![problem_of(error)]),
    };
    let task = metadata.with_history(Vec::new());
    let defects = validate::check_task_metadata(&task, task_id);
    if !defects.is_empty() {
        return Err(defects
            .into_iter()
            .map(|d| Problem {
                file: json_label.clone(),
                field: d.field,
                reason: d.reason,
            })
            .collect());
    }
    let md_path = layout::task_md(&dir);
    let md_label = layout::shared_label(shared, &md_path);
    let (description, problems, history) = match io::read_text(&md_path, &md_label) {
        Ok(text) => {
            let parsed = parse_task(&text, ParseMode::Stored);
            let mut problems = parsed
                .frontmatter_defects
                .iter()
                .chain(&parsed.acceptance_defects)
                .map(|d| Problem {
                    file: md_label.clone(),
                    field: d.field.clone(),
                    reason: d.reason.clone(),
                })
                .collect::<Vec<_>>();
            problems.extend(parsed.history_defects.iter().map(|d| Problem {
                file: md_label.clone(),
                field: d.field.clone(),
                reason: d.reason.clone(),
            }));
            (text, problems, parsed.history)
        }
        Err(error) => (String::new(), vec![problem_of(error)], Vec::new()),
    };
    let mut joined = task;
    joined.history = history;
    Ok(TaskLoad {
        view: task_view(joined, description, file_time(&md_path)),
        problems,
    })
}

/// Build the task view from its two files. `updatedAt` is the newer of the
/// task's own time and the TASK.md modification time.
pub(crate) fn task_view(
    task: TaskFile,
    description: String,
    body_modified: Option<DateTime<Utc>>,
) -> TaskView {
    let (pending_reason, pending_choices) = match current_request(&task) {
        Some(event) => (Some(event.question.clone()), event.choices.clone()),
        None => (None, Vec::new()),
    };
    let updated_at = body_modified.map_or(task.updated_at, |m| m.max(task.updated_at));
    let parts = frontmatter::parse(&description);
    TaskView {
        id: task.id,
        title: task.title,
        description,
        body: parts.body,
        acceptance: parts.acceptance,
        acceptance_error: !parts.defects.is_empty(),
        assignee: task.assignee,
        epic_id: task.epic_id,
        epic: None,
        task_status: task.task_status,
        position: task.position,
        agent_status: task.agent_status,
        is_draft: task.is_draft,
        pending_request_id: task.pending_request_id,
        pending_reason,
        pending_choices,
        archived_at: task.archived_at,
        attachments: task.attachments,
        created_at: task.created_at,
        updated_at,
        agent_status_changed_at: task.agent_status_changed_at,
        task_status_changed_at: task.task_status_changed_at,
        onboarding_sample: task.onboarding_sample,
        history: task.history,
    }
}

/// Resolve the epic of a task from the epics of its project. An epic ID that
/// names no epic leaves the task with no epic.
pub(crate) fn attach_epic(view: &mut TaskView, epics: &[EpicView]) {
    view.epic = view
        .epic_id
        .as_deref()
        .and_then(|id| epics.iter().find(|epic| epic.id.as_str() == id))
        .map(|epic| TaskEpic {
            id: epic.id.clone(),
            name: epic.name.clone(),
            color: epic.color.clone(),
        });
}

/// Read and check `task.json` of one task. A missing task is `task_not_found`;
/// a defect in the file is `file_invalid` with the shared-relative path.
/// This reads workflow metadata independently of TASK.md history.
pub(crate) fn read_task_metadata_strict(
    shared: &Path,
    project_id: &ProjectId,
    task_id: i64,
) -> Result<TaskFile, AgboardError> {
    let project_dir = project_dir_checked(shared, project_id)?;
    let dir = layout::task_dir(&project_dir, task_id);
    if !dir.is_dir() {
        return Err(AgboardError::TaskNotFound { id: task_id });
    }
    let path = layout::task_json(&dir);
    let label = layout::shared_label(shared, &path);
    let bytes = io::read_bytes(&path, &label)?;
    let metadata: TaskMetadata = parse_task_metadata(&bytes, &label)?;
    let task = metadata.with_history(Vec::new());
    if let Some(d) = validate::check_task_metadata(&task, task_id)
        .into_iter()
        .next()
    {
        return Err(AgboardError::FileInvalid {
            file: label,
            field: d.field,
            reason: d.reason,
        });
    }
    Ok(task)
}

/// Join validated task metadata with the canonical TASK.md history.
pub(crate) fn read_task_strict(
    shared: &Path,
    project_id: &ProjectId,
    task_id: i64,
) -> Result<TaskFile, AgboardError> {
    let task = read_task_metadata_strict(shared, project_id, task_id)?;
    let dir = layout::task_dir(&layout::project_dir(shared, project_id), task_id);
    let md_path = layout::task_md(&dir);
    let md_label = layout::shared_label(shared, &md_path);
    let text = io::read_text(&md_path, &md_label)?;
    let parsed = parse_task(&text, ParseMode::Stored);
    if let Some(defect) = parsed.history_defects.first() {
        return Err(AgboardError::FileInvalid {
            file: md_label,
            field: defect.field.clone(),
            reason: defect.reason.clone(),
        });
    }
    let mut joined = task;
    joined.history = parsed.history;
    Ok(joined)
}

/// The text of a task's TASK.md.
pub(crate) fn read_body(
    shared: &Path,
    project_id: &ProjectId,
    task_id: i64,
) -> Result<String, AgboardError> {
    let project_dir = project_dir_checked(shared, project_id)?;
    let path = layout::task_md(&layout::task_dir(&project_dir, task_id));
    io::read_text(&path, &layout::shared_label(shared, &path))
}

/// One task, read strictly: `task.json` must pass, and TASK.md must be readable.
pub fn read_task(
    shared: &Path,
    project_id: &ProjectId,
    task_id: i64,
) -> Result<TaskView, AgboardError> {
    let project_dir = project_dir_checked(shared, project_id)?;
    let _lock = WriteLock::acquire(&layout::write_lock(&project_dir))?;
    transaction::recover_locked(&project_dir)?;
    migrate::migrate_epic_documents(shared, &project_dir)?;
    read_task_locked(shared, project_id, task_id)
}

/// Read one task while the caller already holds its project lock.
pub(crate) fn read_task_locked(
    shared: &Path,
    project_id: &ProjectId,
    task_id: i64,
) -> Result<TaskView, AgboardError> {
    let task = read_task_strict(shared, project_id, task_id)?;
    let body = read_body(shared, project_id, task_id)?;
    let project_dir = layout::project_dir(shared, project_id);
    let md_path = layout::task_md(&layout::task_dir(&project_dir, task_id));
    let mut view = task_view(task, body, file_time(&md_path));
    attach_epic(&mut view, &read_epics(shared, &project_dir).0);
    Ok(view)
}
