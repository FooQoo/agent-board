// file-size: allow (predates the 300-line limit; split it by responsibility rather than growing it)
//! Task operations: creation, title and body edits, the draft flag, archive,
//! restore, and deletion of an archived task.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::Serialize;

use super::super::history::{ParseMode, compose_task, parse_task};
use super::super::io;
use super::super::layout;
use super::super::model::{HistoryRecord, TaskFile, TaskMetadata, TaskView};
use super::super::reader;
use super::super::validate;
use super::super::{FileStore, TaskTextParts};
use super::{
    HistoryKind, Transition, ensure_ai_task_not_done, lane_end, lock_project, save_project,
    save_task, save_task_with_markdown, stamp, transition_event, write_parts, write_text,
};
use crate::domain::{
    Actor, Changed, Column, NewTask, ProjectId, RunState, normalize_and_validate_description,
    validate_title,
};
use crate::error::AgboardError;

/// The description as it is stored: CRLF folded to LF, and at most 50,000 characters of Markdown body. The
/// frontmatter is not counted, because the editor counts only the body.
fn normalize_description(value: &str) -> Result<String, AgboardError> {
    let normalized = value.replace("\r\n", "\n");
    let body = crate::file_store::frontmatter::parse(&normalized).body;
    normalize_and_validate_description(&body)?;
    Ok(normalized)
}

const ARCHIVE_REASON: &str = "Archived by user.";
const RESTORE_REASON: &str = "Restored by user.";

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
        let language = self.history_language.unwrap_or_else(|| {
            super::super::history_language::HistoryLanguage::infer(&body, &title)
        });
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
            evidence: Vec::new(),
            simple_request: None,
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

    /// Change the title and/or the body of a task that is neither archived nor
    /// a draft. An unchanged value changes nothing and writes nothing.
    pub fn edit_task(
        &self,
        project: &ProjectId,
        id: i64,
        title: Option<&str>,
        description: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let title = title.map(validate_title).transpose()?;
        let description = description.map(normalize_description).transpose()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if task.is_draft {
            return Err(AgboardError::TaskIsDraft { id });
        }
        ensure_ai_task_not_done(&task, Actor::Ai)?;
        let (changed, markdown) =
            write_text(shared, project, &project_dir, &mut task, title, description)?;
        if !changed {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        task.updated_at = stamp(now);
        save_task_with_markdown(shared, &project_dir, &task, markdown.as_deref())?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }

    /// Edit body fields against the latest TASK.md read under the project lock.
    pub fn edit_task_parts(
        &self,
        project: &ProjectId,
        id: i64,
        title: Option<&str>,
        parts: TaskTextParts<'_>,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let title = title.map(validate_title).transpose()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if task.is_draft {
            return Err(AgboardError::TaskIsDraft { id });
        }
        ensure_ai_task_not_done(&task, Actor::Ai)?;
        let title_changed = title.as_ref().is_some_and(|value| *value != task.title);
        let markdown = write_parts(
            shared,
            &project_dir,
            &mut task,
            parts.body,
            parts.acceptance,
        )?;
        if !title_changed && markdown.is_none() {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        if let Some(title) = title {
            task.title = title;
        }
        task.updated_at = stamp(now);
        save_task_with_markdown(shared, &project_dir, &task, markdown.as_deref())?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }

    /// Save the title and body of a draft. With `finalize`, the draft flag is
    /// cleared in the same operation. `updatedAt` moves only when a text changes.
    pub fn edit_draft_task(
        &self,
        project: &ProjectId,
        id: i64,
        title: Option<&str>,
        description: Option<&str>,
        finalize: bool,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let title = title.map(validate_title).transpose()?;
        let description = description.map(normalize_description).transpose()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if !task.is_draft {
            return Err(AgboardError::TaskNotDraft { id });
        }
        let (text_changed, markdown) =
            write_text(shared, project, &project_dir, &mut task, title, description)?;
        if !text_changed && !finalize {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        if text_changed {
            task.updated_at = at;
        }
        if finalize {
            task.is_draft = false;
            task.history.push(draft_event(
                &task,
                false,
                at,
                match markdown.as_deref() {
                    Some(text) => self.history_language.unwrap_or_else(|| {
                        super::super::history_language::HistoryLanguage::infer(text, &task.title)
                    }),
                    None => self.history_language(project, &task)?,
                },
            )?);
        }
        save_task_with_markdown(shared, &project_dir, &task, markdown.as_deref())?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }

    /// Edit a draft against the latest TASK.md and finalize in one pair save.
    pub fn edit_draft_task_parts(
        &self,
        project: &ProjectId,
        id: i64,
        title: Option<&str>,
        parts: TaskTextParts<'_>,
        finalize: bool,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let title = title.map(validate_title).transpose()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if !task.is_draft {
            return Err(AgboardError::TaskNotDraft { id });
        }
        let title_changed = title.as_ref().is_some_and(|value| *value != task.title);
        let markdown = write_parts(
            shared,
            &project_dir,
            &mut task,
            parts.body,
            parts.acceptance,
        )?;
        let text_changed = title_changed || markdown.is_some();
        if !text_changed && !finalize {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        if text_changed {
            task.updated_at = at;
        }
        if let Some(title) = title {
            task.title = title;
        }
        if finalize {
            task.is_draft = false;
            task.history.push(draft_event(
                &task,
                false,
                at,
                match markdown.as_deref() {
                    Some(text) => self.history_language.unwrap_or_else(|| {
                        super::super::history_language::HistoryLanguage::infer(text, &task.title)
                    }),
                    None => self.history_language(project, &task)?,
                },
            )?);
        }
        save_task_with_markdown(shared, &project_dir, &task, markdown.as_deref())?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }

    /// Turn the draft flag on or off. Only an idle or pending task can become a
    /// draft. The update time does not move; the history records the change.
    pub fn set_draft(
        &self,
        project: &ProjectId,
        id: i64,
        is_draft: bool,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if task.is_draft == is_draft {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        if is_draft && task.agent_status == RunState::Running {
            return Err(AgboardError::InvalidStateForDraft {
                id,
                state: task.agent_status,
            });
        }
        task.is_draft = is_draft;
        task.history.push(draft_event(
            &task,
            is_draft,
            stamp(now),
            self.history_language(project, &task)?,
        )?);
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }

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

    /// Delete an archived task's folder. Confirmation is the caller's job.
    pub fn delete_archived_task(&self, project: &ProjectId, id: i64) -> Result<(), AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_none() {
            return Err(AgboardError::TaskNotArchived { id });
        }
        let folder = layout::task_dir(&project_dir, id);
        fs::remove_dir_all(&folder)
            .map_err(|e| io::write_error(&layout::shared_label(shared, &folder), e))
    }
}

/// A draft history event. The statuses are the task's current ones.
fn draft_event(
    task: &TaskFile,
    is_draft: bool,
    at: DateTime<Utc>,
    language: super::super::history_language::HistoryLanguage,
) -> Result<HistoryRecord, AgboardError> {
    let event = transition_event(Transition {
        language,
        kind: HistoryKind::Draft,
        reason: Some(if is_draft {
            language.text("Marked task as draft.", "タスクを下書きにしました。")
        } else {
            language.text("Finalized task draft.", "下書きを確定しました。")
        }),
        from_task: Some(task.task_status),
        to_task: task.task_status,
        from_agent: Some(task.agent_status),
        to_agent: task.agent_status,
        at,
    })?;
    Ok(event)
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
    /// Delete any task's folder, archived or not. The CLI `rm` uses this after
    /// its own confirmation; the Web API deletes only archived tasks.
    pub fn delete_task(&self, project: &ProjectId, id: i64) -> Result<(), AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let folder = layout::task_dir(&project_dir, id);
        if !folder.is_dir() {
            return Err(AgboardError::TaskNotFound { id });
        }
        let tasks = layout::tasks_dir(&project_dir);
        let label = layout::shared_label(shared, &folder);
        let trash = tasks.join(format!(
            ".deleting-{}",
            io::random_hex(16).map_err(|e| io::write_error(&label, e))?
        ));
        fs::rename(&folder, &trash).map_err(|e| io::write_error(&label, e))?;
        io::sync_dir(&tasks).map_err(|e| io::write_error(&label, e))?;
        fs::remove_dir_all(&trash).map_err(|e| io::write_error(&label, e))
    }

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
