//! The periodic summaries a project keeps in its `notify/` folder.
//!
//! One file per day, `notify/YYYY-MM-DD.ldjson` (the day of the window's end, in UTC), one JSON
//! object per line. A summary names the results recorded in one window; the server writes it
//! mechanically, with no model involved. A window with no results writes nothing.
//!
//! The files are a permanent record: no line is ever removed. A summary the user has dealt with
//! carries `dismissed: true` and stays in its file. Every change takes the project's write lock,
//! reads the file as it is now, changes only the line it is about, and replaces the file
//! atomically. Lines that cannot be read as a summary (a hand edit gone wrong) are kept as they
//! are and never listed.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Timelike, Utc};
use serde::{Deserialize, Serialize};

use super::FileStore;
use super::io;
use super::layout;
use super::lock::WriteLock;
use super::model::TaskView;
use super::projection::{ChangeSet, Facet, Resource, ResourceChange, ResourceId};
use super::reader::project_dir_checked;
use crate::domain::ProjectId;
use crate::error::AgboardError;

/// The folder inside a project that holds the summary files.
pub const NOTIFY_DIR: &str = "notify";
const EXTENSION: &str = "ldjson";

/// One result a summary reports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResult {
    pub task_id: i64,
    /// The version of the result in the task's results, so a client can open that result. A line
    /// written before this field existed has none and links to the task's results as a whole.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u32>,
    pub title: String,
    #[serde(with = "crate::clock::serde_utc")]
    pub at: DateTime<Utc>,
}

/// The results of one window of one project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// Derived from the end of the window (`s-20261120T093000Z`), so writing a window twice
    /// writes it once.
    pub id: String,
    /// Set when the user dismisses the summary; it stays in the file.
    #[serde(default)]
    pub dismissed: bool,
    #[serde(with = "crate::clock::serde_utc")]
    pub from: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub to: DateTime<Utc>,
    pub results: Vec<SummaryResult>,
}

impl Summary {
    /// The summary of the results recorded after `from` and up to `to` across `tasks`, or `None`
    /// when there are none. Archived cards, drafts, and the guide's sample card are not reported.
    pub fn for_window(
        tasks: &[TaskView],
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Option<Summary> {
        let to = to.with_nanosecond(0).unwrap_or(to);
        let mut results: Vec<SummaryResult> = tasks
            .iter()
            .filter(|t| {
                t.archived_at.is_none() && t.draft.is_none() && t.onboarding_sample.is_none()
            })
            .flat_map(|t| {
                t.results
                    .iter()
                    .filter(|r| r.at > from && r.at <= to)
                    .map(|r| SummaryResult {
                        task_id: t.id,
                        version: Some(r.version),
                        title: r.title.clone(),
                        at: r.at,
                    })
            })
            .collect();
        if results.is_empty() {
            return None;
        }
        results.sort_by_key(|r| (r.at, r.task_id));
        Some(Summary {
            id: format!("s-{}", to.format("%Y%m%dT%H%M%SZ")),
            dismissed: false,
            from,
            to,
            results,
        })
    }
}

/// The change a project's `notify/` folder announces: its messages summary changed, so a client
/// reads the list of summaries again.
pub fn summaries_changed(id: &ProjectId) -> ChangeSet {
    ChangeSet {
        project_id: id.clone(),
        changes: vec![ResourceChange {
            resource: Resource::Messages,
            id: ResourceId::Named(id.to_string()),
            facets: vec![Facet::Summary],
        }],
    }
}

fn file_name(day: DateTime<Utc>) -> String {
    format!("{}.{EXTENSION}", day.format("%Y-%m-%d"))
}

/// The summary files of a folder. Hidden names and other extensions are not summaries.
fn files_in(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension().is_some_and(|e| e == EXTENSION)
                && !p
                    .file_name()
                    .is_some_and(|n| n.to_string_lossy().starts_with('.'))
        })
        .collect();
    files.sort();
    files
}

fn read_lines(path: &Path, shared: &Path) -> Result<Vec<String>, AgboardError> {
    let text = io::read_text(path, &layout::shared_label(shared, path))?;
    Ok(text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(str::to_string)
        .collect())
}

/// Replace the file with `lines`.
fn write_lines(path: &Path, lines: &[String], shared: &Path) -> Result<(), AgboardError> {
    let label = layout::shared_label(shared, path);
    let mut text = lines.join("\n");
    text.push('\n');
    io::write_atomic(path, text.as_bytes(), &label)
}

fn line_id(line: &str) -> Option<String> {
    serde_json::from_str::<Summary>(line).ok().map(|s| s.id)
}

impl FileStore {
    /// Every summary of a project, dismissed ones included, newest first (by the end of the
    /// window). A line that cannot be read, or repeats an id, is skipped.
    pub fn summaries(&self, project: &ProjectId) -> Result<Vec<Summary>, AgboardError> {
        let dir = project_dir_checked(&self.shared, project)?.join(NOTIFY_DIR);
        let mut found: Vec<Summary> = Vec::new();
        for path in files_in(&dir) {
            let Ok(lines) = read_lines(&path, &self.shared) else {
                continue;
            };
            for line in lines {
                if let Ok(summary) = serde_json::from_str::<Summary>(&line)
                    && !found.iter().any(|s| s.id == summary.id)
                {
                    found.push(summary);
                }
            }
        }
        found.sort_by(|a, b| (b.to, &b.id).cmp(&(a.to, &a.id)));
        Ok(found)
    }

    /// Append a summary to the file of the day its window ends. Returns `false` when a summary
    /// with that id is already stored, in which case nothing is written.
    pub fn append_summary(
        &self,
        project: &ProjectId,
        summary: &Summary,
    ) -> Result<bool, AgboardError> {
        let project_dir = project_dir_checked(&self.shared, project)?;
        let _lock = WriteLock::acquire(&layout::write_lock(&project_dir))?;
        let dir = project_dir.join(NOTIFY_DIR);
        let label = layout::shared_label(&self.shared, &dir);
        let exists = files_in(&dir).into_iter().any(|path| {
            read_lines(&path, &self.shared).is_ok_and(|lines| {
                lines
                    .iter()
                    .any(|l| line_id(l).as_deref() == Some(&summary.id))
            })
        });
        if exists {
            return Ok(false);
        }
        fs::create_dir_all(&dir).map_err(|e| io::write_error(&label, e))?;
        let path = dir.join(file_name(summary.to));
        let mut lines = if path.is_file() {
            read_lines(&path, &self.shared)?
        } else {
            Vec::new()
        };
        lines.push(serde_json::to_string(summary).map_err(|e| io::write_error(&label, e))?);
        write_lines(&path, &lines, &self.shared)?;
        Ok(true)
    }

    /// Dismiss one summary: set `dismissed` on its line and nothing else, so other fields of the
    /// line, including ones this build does not know, stay as they are. Dismissing a summary that
    /// is already dismissed changes nothing.
    pub fn dismiss_summary(&self, project: &ProjectId, id: &str) -> Result<Summary, AgboardError> {
        let project_dir = project_dir_checked(&self.shared, project)?;
        let _lock = WriteLock::acquire(&layout::write_lock(&project_dir))?;
        let not_found = || AgboardError::MessageNotFound { id: id.to_string() };
        for path in files_in(&project_dir.join(NOTIFY_DIR)) {
            // An unreadable file cannot hold the summary; `summaries` skips it too.
            let Ok(mut lines) = read_lines(&path, &self.shared) else {
                continue;
            };
            let Some(at) = lines.iter().position(|l| line_id(l).as_deref() == Some(id)) else {
                continue;
            };
            let mut value: serde_json::Value =
                serde_json::from_str(&lines[at]).map_err(|_| not_found())?;
            let current: Summary =
                serde_json::from_value(value.clone()).map_err(|_| not_found())?;
            if current.dismissed {
                return Ok(current);
            }
            value["dismissed"] = serde_json::Value::Bool(true);
            let label = layout::shared_label(&self.shared, &path);
            lines[at] = serde_json::to_string(&value).map_err(|e| io::write_error(&label, e))?;
            let changed: Summary = serde_json::from_value(value).map_err(|_| not_found())?;
            write_lines(&path, &lines, &self.shared)?;
            return Ok(changed);
        }
        Err(not_found())
    }

    /// The end of the newest window any summary of the project covers, if there is one.
    pub fn latest_summary_end(&self, project: &ProjectId) -> Option<DateTime<Utc>> {
        self.summaries(project).ok()?.first().map(|s| s.to)
    }
}

#[cfg(test)]
mod tests;
