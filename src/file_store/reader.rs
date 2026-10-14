//! Reading shared files.
//!
//! Two styles of read exist. The strict reads (`read_*`) fail on the first
//! defect of the file they need, and writes depend on them. The snapshot read
//! keeps going: a broken card is left out and reported in `problems`, and a
//! TASK.md with a format defect is returned as it is, with the defect reported.
//! `project.json` is the one file whose defect fails the whole snapshot.

use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::FileStore;
use super::frontmatter;
use super::history::{ParseMode, parse_task};
use super::index;
use super::io;
use super::layout;
use super::lock::WriteLock;
use super::model::{
    CardEpic, CardView, EpicFile, EpicView, Problem, ProjectFile, TaskFile, TaskMetadata,
    WorkspaceFile, current_request,
};
use super::transaction;
use super::validate;
use crate::domain::{ChangeCursor, ProjectCatalog, ProjectId, ProjectMeta};
use crate::error::AgboardError;

/// One project as the snapshot returns it: the project, its content version and
/// the cursor for that version, its cards with their full history, and every
/// defect that was tolerated while reading it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub project: ProjectMeta,
    pub next_card_id: i64,
    pub version: String,
    pub cursor: ChangeCursor,
    pub epics: Vec<EpicView>,
    pub cards: Vec<CardView>,
    pub problems: Vec<Problem>,
}

/// Read every epic folder. An epic whose `epic.json` is defective is left out
/// and reported in `problems`; its folder is never changed. A defect in
/// PLAN.md is reported while the plan text is still returned.
pub(super) fn read_epics(shared: &Path, project_dir: &Path) -> (Vec<EpicView>, Vec<Problem>) {
    let mut epics = Vec::new();
    let mut problems = Vec::new();
    let Ok(entries) = fs::read_dir(layout::epics_dir(project_dir)) else {
        return (epics, problems);
    };
    let mut folders: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_owned();
            (!name.starts_with('.') && entry.path().is_dir()).then(|| (name, entry.path()))
        })
        .collect();
    folders.sort();
    for (name, folder) in folders {
        let json_path = folder.join("epic.json");
        let json_label = layout::shared_label(shared, &json_path);
        let file: EpicFile = match io::read_bytes(&json_path, &json_label)
            .and_then(|bytes| parse_file::<EpicFile>(&bytes, &json_label))
        {
            Ok(file) => file,
            Err(error) => {
                problems.push(problem_of(error));
                continue;
            }
        };
        let defects = validate::check_epic(&file, &name);
        if !defects.is_empty() {
            problems.extend(defects.into_iter().map(|d| Problem {
                file: json_label.clone(),
                field: d.field,
                reason: d.reason,
            }));
            continue;
        }
        let plan_path = folder.join("PLAN.md");
        let plan_label = layout::shared_label(shared, &plan_path);
        let plan =
            match io::read_text(&plan_path, &plan_label) {
                Ok(text) => {
                    problems.extend(validate::check_plan_body(&text).into_iter().map(|d| {
                        Problem {
                            file: plan_label.clone(),
                            field: d.field,
                            reason: d.reason,
                        }
                    }));
                    text
                }
                Err(error) => {
                    problems.push(problem_of(error));
                    String::new()
                }
            };
        let parts = frontmatter::parse_plan(&plan);
        let (priority, priority_error) = match frontmatter::priority_of(&plan) {
            Ok(order) => (order, false),
            Err(_) => (Vec::new(), true),
        };
        epics.push(EpicView {
            id: file.id,
            name: file.name,
            color: file.color,
            is_draft: file.is_draft,
            plan,
            body: parts.body,
            priority,
            priority_error,
            attachments: file.attachments,
            created_at: file.created_at,
            updated_at: file.updated_at,
        });
    }
    (epics, problems)
}

impl ProjectSnapshot {
    /// The same snapshot without the archived cards (the board and the CLI snapshot).
    pub fn without_archived(mut self) -> ProjectSnapshot {
        self.cards.retain(|card| card.archived_at.is_none());
        self
    }

    /// The same snapshot with only the archived cards (the archive list).
    pub fn only_archived(mut self) -> ProjectSnapshot {
        self.cards.retain(|card| card.archived_at.is_some());
        self
    }
}

/// A snapshot with the time it was fetched, as the CLI, the hook and wait print
/// it. The fetch time is added here, never stored.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedSnapshot<'a> {
    pub fetched_at: String,
    #[serde(flatten)]
    pub snapshot: &'a ProjectSnapshot,
}

/// A card that was read leniently: its view and the defects of its text.
pub(crate) struct CardLoad {
    pub view: CardView,
    pub problems: Vec<Problem>,
}

/// Parse one shared JSON file. Syntax errors, the `formatVersion` gate, and
/// the strict shape (unknown or missing fields) are all reported here.
pub(crate) fn parse_file<T: DeserializeOwned>(
    bytes: &[u8],
    label: &str,
) -> Result<T, AgboardError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|e| AgboardError::FileInvalid {
        file: label.to_string(),
        field: String::new(),
        reason: format!("The JSON is malformed: {e}."),
    })?;
    validate::check_format_version(&value, label)?;
    serde_json::from_value(value).map_err(|e| {
        let message = e.to_string();
        AgboardError::FileInvalid {
            file: label.to_string(),
            field: message.split('`').nth(1).unwrap_or("").to_string(),
            reason: message,
        }
    })
}

fn parse_task_metadata(bytes: &[u8], label: &str) -> Result<TaskMetadata, AgboardError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|e| AgboardError::FileInvalid {
        file: label.to_string(),
        field: String::new(),
        reason: format!("The JSON is malformed: {e}."),
    })?;
    validate::check_format_version_expected(&value, label, 2)?;
    serde_json::from_value(value).map_err(|e| {
        let message = e.to_string();
        AgboardError::FileInvalid {
            file: label.to_string(),
            field: message.split('`').nth(1).unwrap_or("").to_string(),
            reason: message,
        }
    })
}

/// The problem a tolerated read error stands for, with the file label kept.
pub(crate) fn problem_of(error: AgboardError) -> Problem {
    match error {
        AgboardError::FileInvalid {
            file,
            field,
            reason,
        } => Problem {
            file,
            field,
            reason,
        },
        AgboardError::FormatUnsupported {
            file,
            version,
            expected,
        } => Problem {
            file,
            field: "formatVersion".into(),
            reason: format!("Only formatVersion {expected} is supported, found {version}."),
        },
        AgboardError::FileUnreadable { file, reason } => Problem {
            file,
            field: String::new(),
            reason,
        },
        other => Problem {
            file: String::new(),
            field: String::new(),
            reason: other.reason(),
        },
    }
}

fn file_time(path: &Path) -> Option<DateTime<Utc>> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    DateTime::from_timestamp(DateTime::<Utc>::from(modified).timestamp(), 0)
}

/// The project folder, or `project_not_found` when it does not exist.
pub fn project_dir_checked(shared: &Path, id: &ProjectId) -> Result<PathBuf, AgboardError> {
    let dir = layout::project_dir(shared, id);
    if dir.is_dir() {
        Ok(dir)
    } else {
        Err(AgboardError::ProjectNotFound {
            project: id.to_string(),
        })
    }
}

/// Whether `workspace.json` exists. A present file must pass every check.
pub fn workspace_present(shared: &Path) -> Result<bool, AgboardError> {
    let path = layout::workspace_file(shared);
    if !path.is_file() {
        return Ok(false);
    }
    let label = layout::shared_label(shared, &path);
    let bytes = io::read_bytes(&path, &label)?;
    let file: WorkspaceFile = parse_file(&bytes, &label)?;
    match validate::check_workspace(&file).into_iter().next() {
        None => Ok(true),
        Some(d) => Err(AgboardError::FileInvalid {
            file: label,
            field: d.field,
            reason: d.reason,
        }),
    }
}

/// Every project, sorted by name (binary order). A project whose file is
/// defective fails the whole list.
pub fn list_projects(shared: &Path) -> Result<Vec<ProjectMeta>, AgboardError> {
    if !workspace_present(shared)? {
        return Ok(Vec::new());
    }
    let dir = layout::projects_dir(shared);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let entries =
        fs::read_dir(&dir).map_err(|e| io::read_error(&layout::shared_label(shared, &dir), e))?;
    let mut projects = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| io::read_error(&layout::shared_label(shared, &dir), e))?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Ok(id) = ProjectId::from_str(name) else {
            continue;
        };
        if !path.is_dir() {
            continue;
        }
        match read_project_file(shared, &id) {
            Ok(file) => projects.push(meta_of(file)),
            // A project deleted while the folder was being read is left out:
            // the list shows it before or after the deletion, never half of it.
            Err(_) if !path.is_dir() => continue,
            Err(error) => return Err(error),
        }
    }
    projects.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(projects)
}

pub(crate) fn meta_of(file: ProjectFile) -> ProjectMeta {
    ProjectMeta {
        id: file.id,
        name: file.name,
        created_at: file.created_at,
    }
}

/// Read and check `project.json` of a project.
pub fn read_project_file(shared: &Path, id: &ProjectId) -> Result<ProjectFile, AgboardError> {
    let dir = project_dir_checked(shared, id)?;
    let path = layout::project_file(&dir);
    let label = layout::shared_label(shared, &path);
    let bytes = io::read_bytes(&path, &label)?;
    let file: ProjectFile = parse_file(&bytes, &label)?;
    match validate::check_project(&file, id.as_str())
        .into_iter()
        .next()
    {
        None => Ok(file),
        Some(d) => Err(AgboardError::FileInvalid {
            file: label,
            field: d.field,
            reason: d.reason,
        }),
    }
}

/// The card IDs of a project, in ascending order. Only folders with canonical
/// names count; a temporary folder or a stray file is ignored.
pub(crate) fn card_ids(project_dir: &Path) -> Result<Vec<i64>, AgboardError> {
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
        if let Some(id) = name.to_str().and_then(layout::parse_card_dir) {
            ids.push(id);
        }
    }
    ids.sort_unstable();
    Ok(ids)
}

/// Read a card for a snapshot. A defect in `task.json` fails the card, and
/// the caller reports it as problems. A defect in TASK.md returns the text.
pub(crate) fn read_card_lenient(
    shared: &Path,
    project_id: &ProjectId,
    card_id: i64,
) -> Result<CardLoad, Vec<Problem>> {
    let project_dir = layout::project_dir(shared, project_id);
    let dir = layout::task_dir(&project_dir, card_id);
    let json_path = layout::task_json(&dir);
    let json_label = layout::shared_label(shared, &json_path);
    let metadata: TaskMetadata = match io::read_bytes(&json_path, &json_label)
        .and_then(|bytes| parse_task_metadata(&bytes, &json_label))
    {
        Ok(metadata) => metadata,
        Err(error) => return Err(vec![problem_of(error)]),
    };
    let task = metadata.with_history(Vec::new());
    let defects = validate::check_task_metadata(&task, card_id);
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
    let (description, mut problems, history, history_valid) =
        match io::read_text(&md_path, &md_label) {
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
                (
                    text,
                    problems,
                    parsed.history,
                    parsed.history_defects.is_empty(),
                )
            }
            Err(error) => (String::new(), vec![problem_of(error)], Vec::new(), false),
        };
    let mut joined = task;
    joined.history = history;
    if history_valid
        && joined.agent_status == crate::domain::RunState::Pending
        && current_request(&joined).is_none()
    {
        problems.push(Problem {
            file: md_label.clone(),
            field: "pendingRequestId".into(),
            reason: "No history event holds the pending request.".into(),
        });
        joined.history.clear();
    }
    Ok(CardLoad {
        view: card_view(joined, description, file_time(&md_path)),
        problems,
    })
}

/// Build the card view from its two files. `updatedAt` is the newer of the
/// task's own time and the TASK.md modification time.
pub(crate) fn card_view(
    task: TaskFile,
    description: String,
    body_modified: Option<DateTime<Utc>>,
) -> CardView {
    let (pending_reason, pending_choices) = match current_request(&task) {
        Some(event) => (
            event.question.clone(),
            event.choices.clone().unwrap_or_default(),
        ),
        None => (None, Vec::new()),
    };
    let updated_at = body_modified.map_or(task.updated_at, |m| m.max(task.updated_at));
    let parts = frontmatter::parse(&description);
    CardView {
        id: task.id,
        title: task.title,
        description,
        body: parts.body,
        acceptance: parts.acceptance,
        acceptance_error: !parts.defects.is_empty(),
        assignee: task.assignee,
        epic_id: task.epic_id,
        epic: None,
        card_status: task.card_status,
        position: task.position,
        agent_status: task.agent_status,
        is_draft: task.is_draft,
        pending_request_id: task.pending_request_id,
        pending_reason,
        pending_choices,
        archived_at: task.archived_at,
        attachments: task.attachments,
        evidence: task.evidence,
        created_at: task.created_at,
        updated_at,
        agent_status_changed_at: task.agent_status_changed_at,
        history: task.history,
    }
}

/// Resolve the epic of a card from the epics of its project. An epic ID that
/// names no epic leaves the card with no epic.
pub(crate) fn attach_epic(view: &mut CardView, epics: &[EpicView]) {
    view.epic = view
        .epic_id
        .as_deref()
        .and_then(|id| epics.iter().find(|epic| epic.id.as_str() == id))
        .map(|epic| CardEpic {
            id: epic.id.clone(),
            name: epic.name.clone(),
            color: epic.color.clone(),
        });
}

/// Read and check `task.json` of one card. A missing card is `card_not_found`;
/// a defect in the file is `file_invalid` with the shared-relative path.
pub(crate) fn read_task_strict(
    shared: &Path,
    project_id: &ProjectId,
    card_id: i64,
) -> Result<TaskFile, AgboardError> {
    let project_dir = project_dir_checked(shared, project_id)?;
    let dir = layout::task_dir(&project_dir, card_id);
    if !dir.is_dir() {
        return Err(AgboardError::CardNotFound { id: card_id });
    }
    let path = layout::task_json(&dir);
    let label = layout::shared_label(shared, &path);
    let bytes = io::read_bytes(&path, &label)?;
    let metadata: TaskMetadata = parse_task_metadata(&bytes, &label)?;
    let task = metadata.with_history(Vec::new());
    if let Some(d) = validate::check_task_metadata(&task, card_id)
        .into_iter()
        .next()
    {
        return Err(AgboardError::FileInvalid {
            file: label,
            field: d.field,
            reason: d.reason,
        });
    }
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
    if joined.agent_status == crate::domain::RunState::Pending && current_request(&joined).is_none()
    {
        return Err(AgboardError::FileInvalid {
            file: md_label,
            field: "pendingRequestId".into(),
            reason: "No history event holds the pending request.".into(),
        });
    }
    Ok(joined)
}

/// The text of a card's TASK.md.
pub(crate) fn read_body(
    shared: &Path,
    project_id: &ProjectId,
    card_id: i64,
) -> Result<String, AgboardError> {
    let project_dir = project_dir_checked(shared, project_id)?;
    let path = layout::task_md(&layout::task_dir(&project_dir, card_id));
    io::read_text(&path, &layout::shared_label(shared, &path))
}

/// One card, read strictly: `task.json` must pass, and TASK.md must be readable.
pub fn read_card(
    shared: &Path,
    project_id: &ProjectId,
    card_id: i64,
) -> Result<CardView, AgboardError> {
    let project_dir = project_dir_checked(shared, project_id)?;
    let _lock = WriteLock::acquire(&layout::write_lock(&project_dir))?;
    transaction::recover_locked(&project_dir)?;
    read_card_locked(shared, project_id, card_id)
}

/// Read one card while the caller already holds its project lock.
pub(crate) fn read_card_locked(
    shared: &Path,
    project_id: &ProjectId,
    card_id: i64,
) -> Result<CardView, AgboardError> {
    let task = read_task_strict(shared, project_id, card_id)?;
    let body = read_body(shared, project_id, card_id)?;
    let project_dir = layout::project_dir(shared, project_id);
    let md_path = layout::task_md(&layout::task_dir(&project_dir, card_id));
    let mut view = card_view(task, body, file_time(&md_path));
    attach_epic(&mut view, &read_epics(shared, &project_dir).0);
    Ok(view)
}

/// The snapshot of one project: its project file (strict), and every card
/// with the defects that were tolerated.
pub fn read_snapshot(
    shared: &Path,
    project_id: &ProjectId,
) -> Result<ProjectSnapshot, AgboardError> {
    let project_dir = project_dir_checked(shared, project_id)?;
    let _lock = WriteLock::acquire(&layout::write_lock(&project_dir))?;
    transaction::recover_locked(&project_dir)?;
    read_snapshot_locked(shared, project_id)
}

/// Read a project snapshot while its project lock is already held.
pub(crate) fn read_snapshot_locked(
    shared: &Path,
    project_id: &ProjectId,
) -> Result<ProjectSnapshot, AgboardError> {
    let project_dir = project_dir_checked(shared, project_id)?;
    // The version is taken before the files are read: a save in between makes
    // the next reload see a different version and read again.
    let version = index::project_version(&project_dir);
    let cursor = ChangeCursor::new(project_id.clone(), &version)?;
    let file = read_project_file(shared, project_id)?;
    let next_card_id = file.next_card_id;
    let project = meta_of(file);
    let mut cards = Vec::new();
    let (epics, mut problems) = read_epics(shared, &project_dir);
    for card_id in card_ids(&project_dir)? {
        match read_card_lenient(shared, project_id, card_id) {
            Ok(load) => {
                cards.push(load.view);
                problems.extend(load.problems);
            }
            Err(found) => problems.extend(found),
        }
    }
    for card in &mut cards {
        attach_epic(card, &epics);
    }
    Ok(ProjectSnapshot {
        project,
        next_card_id,
        version,
        cursor,
        epics,
        cards,
        problems,
    })
}

/// Every project's unarchived snapshot, with the catalog version of the same read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllSnapshots {
    pub catalog_version: String,
    pub projects: Vec<ProjectSnapshot>,
}

impl FileStore {
    /// The project list with the catalog version, computed from the files read now.
    pub fn catalog(&self) -> Result<ProjectCatalog, AgboardError> {
        let all = self.all_snapshots()?;
        Ok(ProjectCatalog {
            projects: all.projects.iter().map(|p| p.project.clone()).collect(),
            catalog_version: all.catalog_version,
        })
    }

    /// The project with this name. A name that matches no project is
    /// `project_not_found`.
    pub fn project_by_name(&self, name: &str) -> Result<ProjectMeta, AgboardError> {
        list_projects(self.shared_dir())?
            .into_iter()
            .find(|project| project.name == name)
            .ok_or_else(|| AgboardError::ProjectNotFound {
                project: name.to_string(),
            })
    }

    /// One project's unarchived cards, with its version, its cursor, and the
    /// defects of its files.
    pub fn board(&self, id: &ProjectId) -> Result<ProjectSnapshot, AgboardError> {
        Ok(read_snapshot(self.shared_dir(), id)?.without_archived())
    }

    /// One project's archived cards, read the same way as [`FileStore::board`].
    pub fn archive_snapshot(&self, id: &ProjectId) -> Result<ProjectSnapshot, AgboardError> {
        Ok(read_snapshot(self.shared_dir(), id)?.only_archived())
    }

    /// Every project's unarchived snapshot in name order, with the catalog
    /// version. A project whose `project.json` is defective fails the whole read.
    pub fn all_snapshots(&self) -> Result<AllSnapshots, AgboardError> {
        let mut projects = Vec::new();
        for meta in list_projects(self.shared_dir())? {
            projects.push(self.board(&meta.id)?);
        }
        let mut by_id: Vec<(&ProjectId, &str)> = projects
            .iter()
            .map(|p| (&p.project.id, p.version.as_str()))
            .collect();
        by_id.sort_by(|a, b| a.0.cmp(b.0));
        let catalog_version = index::catalog_version_of(by_id);
        Ok(AllSnapshots {
            catalog_version,
            projects,
        })
    }
}
