//! Writes to the shared files.
//!
//! Every write takes the project's write lock, reads the latest files, checks
//! the rules against them, changes only the required items, and saves. The
//! lock covers TASK.md saves made by the CLI and the Web, so a draft check and
//! the body save cannot interleave with another writer. Direct editor saves
//! do not take the lock.

mod agent;
mod answer;
mod attachment;
mod card;
mod completion;
mod epic;
mod evidence;

pub use answer::Answer;

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

use super::frontmatter::{self, AcceptanceItem};
use super::history::{ParseMode, compose_task, parse_task};
use super::io;
use super::layout;
use super::lock::WriteLock;
use super::model::{HistoryRecord, ProjectFile, TaskFile};
use super::reader;
use super::transaction;
use crate::clock::{format_utc, parse_utc};
use crate::domain::{Actor, Column, ProjectId, RunState};
use crate::error::AgboardError;

/// A Done card is immutable to agent-facing FileStore operations. User
/// operations keep their existing reopen/edit paths.
pub(super) fn ensure_ai_card_not_done(task: &TaskFile, actor: Actor) -> Result<(), AgboardError> {
    if actor == Actor::Ai && task.card_status == Column::Done {
        Err(AgboardError::CardIsDone { id: task.id })
    } else {
        Ok(())
    }
}

/// A timestamp as it is stored: UTC, second precision.
pub(super) fn stamp(now: DateTime<Utc>) -> DateTime<Utc> {
    parse_utc(&format_utc(now)).unwrap_or(now)
}

/// A new 32-character lowercase hexadecimal identifier (request IDs).
pub(super) fn new_id() -> Result<String, AgboardError> {
    io::random_hex(16).map_err(|e| io::write_error("task.json", e))
}

/// Check that the project exists and take its write lock. The returned folder
/// is the project folder.
pub(crate) fn lock_project(
    shared: &Path,
    project: &ProjectId,
) -> Result<(PathBuf, WriteLock), AgboardError> {
    let dir = reader::project_dir_checked(shared, project)?;
    let lock = WriteLock::acquire(&layout::write_lock(&dir))?;
    transaction::recover_locked(&dir)?;
    Ok((dir, lock))
}

pub(super) fn save_project(
    shared: &Path,
    project_dir: &Path,
    file: &ProjectFile,
) -> Result<(), AgboardError> {
    let path = layout::project_file(project_dir);
    io::write_json(&path, file, &layout::shared_label(shared, &path))
}

pub(super) fn save_task(
    shared: &Path,
    project_dir: &Path,
    task: &TaskFile,
) -> Result<(), AgboardError> {
    save_task_with_markdown(shared, project_dir, task, None)
}

pub(super) fn save_task_with_markdown(
    shared: &Path,
    project_dir: &Path,
    task: &TaskFile,
    replacement: Option<&str>,
) -> Result<(), AgboardError> {
    use super::history::{ParseMode, compose_task, parse_task};
    use super::model::TaskMetadata;
    use super::transaction::{PairBytes, PairTargets, save_pair_locked};

    let dir = layout::task_dir(project_dir, task.id);
    let json_path = layout::task_json(&dir);
    let md_path = layout::task_md(&dir);
    let json_label = layout::shared_label(shared, &json_path);
    let md_label = layout::shared_label(shared, &md_path);
    let old = PairBytes {
        metadata: io::read_bytes(&json_path, &json_label)?,
        markdown: io::read_bytes(&md_path, &md_label)?,
    };
    let text = std::str::from_utf8(&old.markdown).map_err(|_| {
        crate::error::AgboardError::FileUnreadable {
            file: md_label.clone(),
            reason: "the file is not valid UTF-8".into(),
        }
    })?;
    let parsed = parse_task(text, ParseMode::Stored);
    if let Some(defect) = parsed.history_defects.first() {
        return Err(AgboardError::FileInvalid {
            file: md_label,
            field: defect.field.clone(),
            reason: defect.reason.clone(),
        });
    }
    if task.history.len() < parsed.history.len()
        || task.history[..parsed.history.len()] != parsed.history
    {
        return Err(io::write_error(
            &json_label,
            "The task history changed before the operation could be saved.",
        ));
    }
    let markdown = if let Some(replacement) = replacement {
        let parts = frontmatter::parse(replacement);
        compose_task(replacement, &parts.body, None, &task.history)
            .map_err(|defect| AgboardError::FileInvalid {
                file: md_label.clone(),
                field: defect.field,
                reason: defect.reason,
            })?
            .into_bytes()
    } else if task.history == parsed.history {
        old.markdown.clone()
    } else {
        compose_task(text, &parsed.body, None, &task.history)
            .map_err(|defect| AgboardError::FileInvalid {
                file: md_label.clone(),
                field: defect.field,
                reason: defect.reason,
            })?
            .into_bytes()
    };
    let mut json = serde_json::to_vec_pretty(&TaskMetadata::from(task))
        .map_err(|error| io::write_error(&json_label, error))?;
    json.push(b'\n');
    save_pair_locked(
        project_dir,
        &PairTargets {
            metadata: std::path::PathBuf::from(format!("tasks/{}/task.json", task.id)),
            markdown: std::path::PathBuf::from(format!("tasks/{}/TASK.md", task.id)),
        },
        &old,
        &PairBytes {
            metadata: json,
            markdown,
        },
    )
}

/// Context used to generate an informative default reason.
#[derive(Debug, Clone, Copy)]
pub(super) enum HistoryKind {
    Created,
    Lane,
    Agent,
    Draft,
    Epic,
    Archive,
    Restore,
}

pub(super) struct Transition<'a> {
    pub kind: HistoryKind,
    pub reason: Option<&'a str>,
    pub from_card: Option<Column>,
    pub to_card: Column,
    pub from_agent: Option<RunState>,
    pub to_agent: RunState,
    pub at: DateTime<Utc>,
}

pub(super) fn transition_event(t: Transition<'_>) -> Result<HistoryRecord, AgboardError> {
    let fallback = match t.kind {
        HistoryKind::Created => format!(
            "Created card in {} with agent {}.",
            t.to_card.label(),
            t.to_agent.as_str()
        ),
        HistoryKind::Lane => format!(
            "Moved card from {} to {}; agent is {}.",
            t.from_card.unwrap_or(t.to_card).label(),
            t.to_card.label(),
            t.to_agent.as_str()
        ),
        HistoryKind::Agent => format!(
            "Changed agent from {} to {} in {}.",
            t.from_agent.unwrap_or(t.to_agent).as_str(),
            t.to_agent.as_str(),
            t.to_card.label()
        ),
        HistoryKind::Draft => "Changed card draft status.".into(),
        HistoryKind::Epic => "Changed card epic.".into(),
        HistoryKind::Archive => format!("Archived card in {}; agent is idle.", t.to_card.label()),
        HistoryKind::Restore => format!("Restored card in {}.", t.to_card.label()),
    };
    let reason = reason_or_default(t.reason, fallback)?;
    Ok(HistoryRecord { at: t.at, reason })
}

pub(super) fn reason_or_default(
    reason: Option<&str>,
    fallback: String,
) -> Result<String, AgboardError> {
    let reason = reason
        .filter(|reason| !reason.trim().is_empty())
        .unwrap_or(&fallback);
    crate::domain::validate_work_reason(reason)?;
    Ok(reason.to_owned())
}

/// The position after the last unarchived card of a lane, read from the files.
/// Cards whose `task.json` is broken are not counted.
pub(super) fn lane_end(
    shared: &Path,
    project: &ProjectId,
    lane: Column,
) -> Result<i64, AgboardError> {
    let project_dir = layout::project_dir(shared, project);
    let mut last = 0;
    for card_id in reader::card_ids(&project_dir)? {
        if let Ok(load) = reader::read_card_lenient(shared, project, card_id) {
            let card = load.view;
            if card.card_status == lane && card.archived_at.is_none() {
                last = last.max(card.position);
            }
        }
    }
    last.checked_add(1)
        .ok_or_else(|| io::write_error("task.json", "The lane position overflowed."))
}

/// Save the title and/or the body of a card under the lock. The body is
/// validated before anything is written. Returns whether either text changed.
/// The caller sets `updatedAt` and saves `task.json`.
pub(super) fn write_text(
    shared: &Path,
    project: &ProjectId,
    project_dir: &Path,
    task: &mut TaskFile,
    title: Option<String>,
    description: Option<String>,
) -> Result<(bool, Option<String>), AgboardError> {
    let current_body = reader::read_body(shared, project, task.id)?;
    let next_title = title.unwrap_or_else(|| task.title.clone());
    let next_body = description.unwrap_or_else(|| current_body.clone());
    let title_changed = next_title != task.title;
    let body_changed = next_body != current_body;
    if !title_changed && !body_changed {
        return Ok((false, None));
    }
    let mut replacement = None;
    if body_changed {
        let label = layout::shared_label(
            shared,
            &layout::task_md(&layout::task_dir(project_dir, task.id)),
        );
        super::validate::ensure_task_body(&next_body, &label)?;
        let parts = super::frontmatter::parse(&next_body);
        let composed = compose_task(
            &next_body,
            &parts.body,
            Some(&parts.acceptance),
            &task.history,
        )
        .map_err(|defect| AgboardError::FileInvalid {
            file: label.clone(),
            field: defect.field,
            reason: defect.reason,
        })?;
        replacement = Some(composed);
    }
    task.title = next_title;
    Ok((true, replacement))
}

pub(super) fn write_parts(
    shared: &Path,
    project_dir: &Path,
    task: &mut TaskFile,
    body: Option<&str>,
    acceptance: Option<&[AcceptanceItem]>,
) -> Result<Option<String>, AgboardError> {
    if body.is_none() && acceptance.is_none() {
        return Ok(None);
    }
    let md_path = layout::task_md(&layout::task_dir(project_dir, task.id));
    let label = layout::shared_label(shared, &md_path);
    let original = io::read_text(&md_path, &label)?;
    let parsed = parse_task(&original, ParseMode::Stored);
    if let Some(defect) = parsed.history_defects.first() {
        return Err(AgboardError::FileInvalid {
            file: label,
            field: defect.field.clone(),
            reason: defect.reason.clone(),
        });
    }
    let next_body = body.unwrap_or(&parsed.body).replace("\r\n", "\n");
    crate::domain::normalize_and_validate_description(&next_body)?;
    let composed =
        compose_task(&original, &next_body, acceptance, &task.history).map_err(|defect| {
            AgboardError::FileInvalid {
                file: label.clone(),
                field: defect.field,
                reason: defect.reason,
            }
        })?;
    Ok((composed != original).then_some(composed))
}
