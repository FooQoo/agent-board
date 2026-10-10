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
mod epic;
mod evidence;

pub use answer::Answer;

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

use super::io;
use super::layout;
use super::lock::WriteLock;
use super::model::{HistoryKind, HistoryRecord, ProjectFile, TaskFile};
use super::reader;
use crate::clock::{format_utc, parse_utc};
use crate::domain::{Actor, Column, ProjectId, RunState};
use crate::error::SkanError;

/// A timestamp as it is stored: UTC, second precision.
pub(super) fn stamp(now: DateTime<Utc>) -> DateTime<Utc> {
    parse_utc(&format_utc(now)).unwrap_or(now)
}

/// A new 32-character lowercase hexadecimal identifier (history and request IDs).
pub(super) fn new_id() -> Result<String, SkanError> {
    io::random_hex(16).map_err(|e| io::write_error("task.json", e))
}

/// Check that the project exists and take its write lock. The returned folder
/// is the project folder.
pub(super) fn lock_project(
    shared: &Path,
    project: &ProjectId,
) -> Result<(PathBuf, WriteLock), SkanError> {
    let dir = reader::project_dir_checked(shared, project)?;
    let lock = WriteLock::acquire(&layout::write_lock(&dir))?;
    Ok((dir, lock))
}

pub(super) fn save_project(
    shared: &Path,
    project_dir: &Path,
    file: &ProjectFile,
) -> Result<(), SkanError> {
    let path = layout::project_file(project_dir);
    io::write_json(&path, file, &layout::shared_label(shared, &path))
}

pub(super) fn save_task(
    shared: &Path,
    project_dir: &Path,
    task: &TaskFile,
) -> Result<(), SkanError> {
    let path = layout::task_json(&layout::task_dir(project_dir, task.id));
    io::write_json(&path, task, &layout::shared_label(shared, &path))
}

pub(super) fn save_body(
    shared: &Path,
    project_dir: &Path,
    card_id: i64,
    text: &str,
) -> Result<(), SkanError> {
    let path = layout::task_md(&layout::task_dir(project_dir, card_id));
    io::write_atomic(&path, text.as_bytes(), &layout::shared_label(shared, &path))
}

/// The fields of one history event that depend on what happened.
pub(super) struct Transition<'a> {
    pub kind: HistoryKind,
    pub actor: Actor,
    pub reason: Option<&'a str>,
    pub from_card: Option<Column>,
    pub to_card: Column,
    pub from_agent: Option<RunState>,
    pub to_agent: RunState,
    pub request_id: Option<&'a str>,
    pub at: DateTime<Utc>,
}

pub(super) fn transition_event(t: Transition<'_>) -> Result<HistoryRecord, SkanError> {
    Ok(HistoryRecord {
        id: new_id()?,
        kind: t.kind,
        actor: t.actor,
        reason: t.reason.map(str::to_owned),
        from_card_status: t.from_card,
        to_card_status: t.to_card,
        from_agent_status: t.from_agent,
        to_agent_status: t.to_agent,
        request_id: t.request_id.map(str::to_owned),
        question: None,
        choices: None,
        choice_id: None,
        choice_label: None,
        is_draft: None,
        from_epic_id: None,
        to_epic_id: None,
        at: t.at,
    })
}

/// The position after the last unarchived card of a lane, read from the files.
/// Cards whose `task.json` is broken are not counted.
pub(super) fn lane_end(shared: &Path, project: &ProjectId, lane: Column) -> Result<i64, SkanError> {
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
) -> Result<bool, SkanError> {
    let current_body = reader::read_body(shared, project, task.id)?;
    let next_title = title.unwrap_or_else(|| task.title.clone());
    let next_body = description.unwrap_or_else(|| current_body.clone());
    let title_changed = next_title != task.title;
    let body_changed = next_body != current_body;
    if !title_changed && !body_changed {
        return Ok(false);
    }
    if body_changed {
        let label = layout::shared_label(
            shared,
            &layout::task_md(&layout::task_dir(project_dir, task.id)),
        );
        super::validate::ensure_task_body(&next_body, &label)?;
        save_body(shared, project_dir, task.id, &next_body)?;
    }
    task.title = next_title;
    Ok(true)
}
