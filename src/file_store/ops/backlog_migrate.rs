//! The one-time conversion of the AI drafts of earlier versions to the Backlog.
//!
//! The first write to a project (or the start of `serve`), under the project
//! lock: every `task.json` and `epic.json` that still holds `draft: "ai"` is
//! converted by `legacy_draft`, and all of them are saved in one batch, so the
//! conversion happens completely or not at all. Afterwards no `draft: "ai"` is
//! left, so a second run finds nothing and changes nothing. A project that was
//! checked gets the marker `.internal/backlog-migrated`, which spares the next
//! writes the scan. Read-only commands never write; they read the old marks as
//! the Backlog (see `legacy_draft`).

use std::path::{Path, PathBuf};

use chrono::Utc;
use serde_json::Value;

use super::save::task_pair_changes;
use crate::domain::{Column, ProjectId};
use crate::error::AgboardError;
use crate::file_store::legacy_draft::{is_legacy_ai_draft, upgrade_epic_value};
use crate::file_store::model::HistoryRecord;
use crate::file_store::transaction::{FileChange, save_batch_locked};
use crate::file_store::{FileStore, io, layout, reader};

fn marker(project_dir: &Path) -> PathBuf {
    project_dir.join(".internal").join("backlog-migrated")
}

/// The parsed file when it still holds `draft: "ai"`.
fn legacy_json(path: &Path, label: &str) -> Result<Option<Value>, AgboardError> {
    let bytes = io::read_bytes(path, label)?;
    Ok(serde_json::from_slice::<Value>(&bytes)
        .ok()
        .filter(is_legacy_ai_draft))
}

/// Convert the AI drafts of a project, if there are any. The caller holds the
/// project lock. Returns whether anything was converted.
pub(in crate::file_store) fn migrate_ai_drafts_locked(
    shared: &Path,
    project: &ProjectId,
    project_dir: &Path,
) -> Result<bool, AgboardError> {
    let marker = marker(project_dir);
    if marker.exists() {
        return Ok(false);
    }
    let store = FileStore::open(shared);
    let at = super::stamp(Utc::now());
    let mut changes: Vec<FileChange> = Vec::new();

    for task_id in reader::task_ids(project_dir)? {
        let json = layout::task_json(&layout::task_dir(project_dir, task_id));
        let label = layout::shared_label(shared, &json);
        let Some(raw) = legacy_json(&json, &label)? else {
            continue;
        };
        // Read with the conversion applied, as every reader sees it.
        let mut task = reader::read_task_strict(shared, project, task_id)?;
        if task.task_status == Column::Backlog {
            let from = raw
                .get("taskStatus")
                .and_then(Value::as_str)
                .unwrap_or("todo");
            let language = store.history_language(project, &task)?;
            task.updated_at = at;
            task.history.push(HistoryRecord {
                at,
                reason: language
                    .text(
                        &format!("Moved the AI draft from {from} to the Backlog."),
                        &format!("AI の下書き({from})を Backlog に移しました。"),
                    )
                    .to_owned(),
            });
        }
        changes.extend(task_pair_changes(shared, project_dir, &task, None)?);
    }

    let epics_dir = layout::epics_dir(project_dir);
    if epics_dir.is_dir() {
        let mut names: Vec<String> = std::fs::read_dir(&epics_dir)
            .map_err(|e| io::read_error("epics", e))?
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
            .filter(|name| !name.starts_with('.'))
            .collect();
        names.sort();
        for name in names {
            let path = epics_dir.join(&name).join("epic.json");
            if !path.is_file() {
                continue;
            }
            let label = layout::shared_label(shared, &path);
            let Some(mut value) = legacy_json(&path, &label)? else {
                continue;
            };
            let old = io::read_bytes(&path, &label)?;
            upgrade_epic_value(&mut value);
            if let Some(object) = value.as_object_mut() {
                object.insert(
                    "updatedAt".into(),
                    Value::String(crate::clock::format_utc(at)),
                );
            }
            let mut new =
                serde_json::to_vec_pretty(&value).map_err(|e| io::write_error(&label, e))?;
            new.push(b'\n');
            changes.push(FileChange {
                target: PathBuf::from(format!("epics/{name}/epic.json")),
                old: Some(old),
                new: Some(new),
            });
        }
    }

    let converted = !changes.is_empty();
    if converted {
        save_batch_locked(project_dir, changes)?;
    }
    // Only after the batch is saved: an interrupted run has no marker and runs again.
    if let Some(dir) = marker.parent() {
        std::fs::create_dir_all(dir).map_err(|e| io::write_error(".internal", e))?;
    }
    io::write_atomic(&marker, b"1\n", ".internal/backlog-migrated")?;
    Ok(converted)
}

impl FileStore {
    /// The start of a server: take every project's lock once, which runs the
    /// conversion of the old AI drafts. A project that fails is left as it is and
    /// is tried again at its next write.
    pub fn migrate_backlog(&self) {
        let Ok(projects) = self.projects() else {
            return;
        };
        for meta in projects {
            let _ = super::lock_project(self.shared_dir(), &meta.id);
        }
    }
}
