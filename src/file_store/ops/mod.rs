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
mod completion;
mod epic;
mod history_event;
mod onboarding;
mod request_create;
mod save;
mod task;
mod text;

pub use answer::Answer;

use self::history_event::{HistoryKind, Transition, reason_or_default, transition_event};
use self::save::{save_task, save_task_with_markdown};
use self::text::{write_parts, write_text};

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

use super::io;
use super::layout;
use super::lock::WriteLock;
use super::model::{ProjectFile, TaskFile};
use super::reader;
use super::transaction;
use crate::clock::{format_utc, parse_utc};
use crate::domain::{Actor, Column, ProjectId};
use crate::error::AgboardError;

/// A Done task is immutable to agent-facing FileStore operations. User
/// operations keep their existing reopen/edit paths.
pub(super) fn ensure_ai_task_not_done(task: &TaskFile, actor: Actor) -> Result<(), AgboardError> {
    if actor == Actor::Ai && task.task_status == Column::Done {
        Err(AgboardError::TaskIsDone { id: task.id })
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
    super::migrate::migrate_epic_documents(shared, &dir)?;
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

/// The position after the last unarchived task of a lane, read from the files.
/// Tasks whose `task.json` is broken are not counted.
pub(super) fn lane_end(
    shared: &Path,
    project: &ProjectId,
    lane: Column,
) -> Result<i64, AgboardError> {
    let project_dir = layout::project_dir(shared, project);
    let mut last = 0;
    for task_id in reader::task_ids(&project_dir)? {
        if let Ok(load) = reader::read_task_lenient(shared, project, task_id) {
            let task = load.view;
            if task.task_status == lane && task.archived_at.is_none() {
                last = last.max(task.position);
            }
        }
    }
    last.checked_add(1)
        .ok_or_else(|| io::write_error("task.json", "The lane position overflowed."))
}
