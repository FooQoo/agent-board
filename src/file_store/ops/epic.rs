//! Epic operations: creation under a temporary folder, the update of the
//! metadata and the plan, deletion refused while cards refer to the epic, and
//! the epic of a card. Every write holds the project's write lock.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::frontmatter;
use super::super::io;
use super::super::layout;
use super::super::model::{CardView, EpicFile, EpicUpdate, EpicView, HistoryKind, NewEpic};
use super::super::reader;
use super::super::validate::{self, EpicId};
use super::{Transition, lock_project, save_task, stamp, transition_event};
use crate::domain::{Actor, Changed, ProjectId};
use crate::error::AgboardError;

/// The epic folder and its `epic.json`, read strictly. A missing folder is
/// `epic_not_found`; a defect in the file is `file_invalid`.
pub(super) fn read_epic_file(
    shared: &Path,
    project: &ProjectId,
    id: &EpicId,
) -> Result<(PathBuf, EpicFile), AgboardError> {
    let project_dir = reader::project_dir_checked(shared, project)?;
    let dir = layout::epic_dir(&project_dir, id);
    if !dir.is_dir() {
        return Err(AgboardError::EpicNotFound { id: id.to_string() });
    }
    let path = layout::epic_file(&dir);
    let label = layout::shared_label(shared, &path);
    let bytes = io::read_bytes(&path, &label)?;
    let file: EpicFile = reader::parse_file(&bytes, &label)?;
    match validate::check_epic(&file, id.as_str()).into_iter().next() {
        None => Ok((dir, file)),
        Some(d) => Err(AgboardError::FileInvalid {
            file: label,
            field: d.field,
            reason: d.reason,
        }),
    }
}

fn read_plan(shared: &Path, dir: &Path) -> Result<String, AgboardError> {
    let path = layout::epic_plan(dir);
    io::read_text(&path, &layout::shared_label(shared, &path))
}

fn view_of(file: EpicFile, plan: String) -> EpicView {
    let parts = frontmatter::parse(&plan);
    EpicView {
        id: file.id,
        name: file.name,
        color: file.color,
        is_draft: file.is_draft,
        plan,
        body: parts.body,
        acceptance: parts.acceptance,
        acceptance_error: !parts.defects.is_empty(),
        attachments: file.attachments,
        created_at: file.created_at,
        updated_at: file.updated_at,
    }
}

/// An epic as it is stored: `epic.json` and PLAN.md read together.
pub(super) fn epic_view(
    shared: &Path,
    project: &ProjectId,
    id: &EpicId,
) -> Result<EpicView, AgboardError> {
    let (dir, file) = read_epic_file(shared, project, id)?;
    let plan = read_plan(shared, &dir)?;
    Ok(view_of(file, plan))
}

/// A `#RRGGBB` color that none of `used` has. The color is random; a collision
/// is drawn again, so a saved color is never handed out twice.
fn random_color<'a>(used: impl Iterator<Item = &'a str> + Clone) -> Result<String, AgboardError> {
    for _ in 0..1_000 {
        let hex = io::random_hex(3).map_err(|e| io::write_error("epic.json", e))?;
        let color = format!("#{}", hex.to_ascii_uppercase());
        if !used.clone().any(|saved| saved.eq_ignore_ascii_case(&color)) {
            return Ok(color);
        }
    }
    Err(io::write_error("epic.json", "no free color could be drawn"))
}

fn save_epic(shared: &Path, dir: &Path, file: &EpicFile) -> Result<(), AgboardError> {
    let path = layout::epic_file(dir);
    io::write_json(&path, file, &layout::shared_label(shared, &path))
}

fn save_plan(shared: &Path, dir: &Path, text: &str) -> Result<(), AgboardError> {
    let path = layout::epic_plan(dir);
    io::write_atomic(&path, text.as_bytes(), &layout::shared_label(shared, &path))
}

/// The plan to store: the given text with CRLF folded, or the template when
/// no text (or only whitespace) is given.
fn plan_to_store(plan: Option<String>) -> Result<String, AgboardError> {
    match plan {
        Some(text) if !text.trim().is_empty() => validate::normalize_plan(&text),
        _ => Ok(validate::plan_template()),
    }
}

impl FileStore {
    /// Create an epic. The ID is folded to uppercase and checked, the color is
    /// stored as `#RRGGBB`, and the folder is built under a temporary name and
    /// renamed into place. An existing folder of that ID is `epic_id_taken`.
    pub fn create_epic(
        &self,
        project: &ProjectId,
        new: NewEpic,
        now: DateTime<Utc>,
    ) -> Result<EpicView, AgboardError> {
        let id = EpicId::normalize(&new.id)?;
        let name = validate::validate_epic_name(&new.name)?;
        let plan = plan_to_store(new.plan)?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let color = match new.color.as_deref() {
            Some(text) => validate::normalize_color(text)?,
            None => {
                let used = reader::read_epics(shared, &project_dir).0;
                random_color(used.iter().map(|epic| epic.color.as_str()))?
            }
        };

        let target = layout::epic_dir(&project_dir, &id);
        if fs::symlink_metadata(&target).is_ok() {
            return Err(AgboardError::EpicIdTaken { id: id.to_string() });
        }
        let label = layout::shared_label(shared, &target);
        let plan_label = format!("{label}/PLAN.md");
        validate::ensure_plan_body(&plan, &plan_label)?;

        let epics = layout::epics_dir(&project_dir);
        fs::create_dir_all(&epics).map_err(|e| io::write_error(&label, e))?;
        let temp = epics.join(format!(
            ".new-{}",
            io::random_hex(16).map_err(|e| io::write_error(&label, e))?
        ));
        let at = stamp(now);
        let file = EpicFile {
            format_version: layout::FORMAT_VERSION,
            id: id.clone(),
            name,
            color,
            is_draft: new.is_draft,
            attachments: Vec::new(),
            created_at: at,
            updated_at: at,
        };
        let result = (|| -> Result<(), AgboardError> {
            fs::create_dir(&temp).map_err(|e| io::write_error(&label, e))?;
            save_epic(shared, &temp, &file)?;
            io::write_atomic(&layout::epic_plan(&temp), plan.as_bytes(), &plan_label)?;
            fs::rename(&temp, &target).map_err(|e| io::write_error(&label, e))?;
            io::sync_dir(&epics).map_err(|e| io::write_error(&label, e))
        })();
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&temp);
            return Err(error);
        }
        epic_view(shared, project, &id)
    }

    /// Read one epic with its plan.
    pub fn epic(&self, project: &ProjectId, id: &EpicId) -> Result<EpicView, AgboardError> {
        epic_view(self.shared_dir(), project, id)
    }

    /// Change an epic's name, color, draft flag, and/or plan. The plan is
    /// checked before anything is written; PLAN.md is saved before epic.json.
    /// A value that does not change writes nothing.
    pub fn update_epic(
        &self,
        project: &ProjectId,
        id: &EpicId,
        update: EpicUpdate,
        now: DateTime<Utc>,
    ) -> Result<Changed<EpicView>, AgboardError> {
        let name = update
            .name
            .as_deref()
            .map(validate::validate_epic_name)
            .transpose()?;
        let color = update
            .color
            .as_deref()
            .map(validate::normalize_color)
            .transpose()?;
        let plan = update
            .plan
            .as_deref()
            .map(validate::normalize_plan)
            .transpose()?;
        let shared = self.shared_dir();
        let (_project_dir, _lock) = lock_project(shared, project)?;
        let (dir, mut file) = read_epic_file(shared, project, id)?;

        let mut changed = false;
        if let Some(name) = name
            && name != file.name
        {
            file.name = name;
            changed = true;
        }
        if let Some(color) = color
            && color != file.color
        {
            file.color = color;
            changed = true;
        }
        if let Some(is_draft) = update.is_draft
            && is_draft != file.is_draft
        {
            file.is_draft = is_draft;
            changed = true;
        }
        let current_plan = read_plan(shared, &dir)?;
        let next_plan = plan.unwrap_or_else(|| current_plan.clone());
        let plan_changed = next_plan != current_plan;
        if plan_changed {
            let label = layout::shared_label(shared, &layout::epic_plan(&dir));
            validate::ensure_plan_body(&next_plan, &label)?;
            save_plan(shared, &dir, &next_plan)?;
            changed = true;
        }
        if changed {
            file.updated_at = stamp(now);
            save_epic(shared, &dir, &file)?;
        }
        Ok(Changed {
            value: view_of(file, next_plan),
            changed,
        })
    }

    /// Delete an epic folder. Refused with `epic_in_use` while any card, archived
    /// ones included, names the epic. The folder is renamed out of the way first,
    /// then removed. A folder whose `epic.json` is broken can still be deleted.
    pub fn delete_epic(&self, project: &ProjectId, id: &EpicId) -> Result<(), AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let dir = layout::epic_dir(&project_dir, id);
        if !dir.is_dir() {
            return Err(AgboardError::EpicNotFound { id: id.to_string() });
        }
        for card_id in reader::card_ids(&project_dir)? {
            let task = reader::read_task_strict(shared, project, card_id)?;
            if task.epic_id.as_deref() == Some(id.as_str()) {
                return Err(AgboardError::EpicInUse { id: id.to_string() });
            }
        }
        let epics = layout::epics_dir(&project_dir);
        let label = layout::shared_label(shared, &dir);
        let trash = epics.join(format!(
            ".deleting-{}",
            io::random_hex(16).map_err(|e| io::write_error(&label, e))?
        ));
        fs::rename(&dir, &trash).map_err(|e| io::write_error(&label, e))?;
        io::sync_dir(&epics).map_err(|e| io::write_error(&label, e))?;
        fs::remove_dir_all(&trash).map_err(|e| io::write_error(&label, e))
    }

    /// Set (`Some`) or clear (`None`) the epic of a card. Only a real change
    /// adds an epic history event and moves `updatedAt`. An AI cannot change an
    /// archived or draft card; a person can.
    pub fn set_card_epic(
        &self,
        project: &ProjectId,
        card_id: i64,
        epic: Option<&EpicId>,
        actor: Actor,
        now: DateTime<Utc>,
    ) -> Result<Changed<CardView>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, card_id)?;
        if matches!(actor, Actor::Ai) {
            if task.archived_at.is_some() {
                return Err(AgboardError::CardArchived { id: card_id });
            }
            if task.is_draft {
                return Err(AgboardError::CardIsDraft { id: card_id });
            }
        }
        if let Some(id) = epic {
            read_epic_file(shared, project, id)?;
        }
        let next = epic.map(|id| id.to_string());
        if task.epic_id == next {
            return Ok(Changed {
                value: reader::read_card(shared, project, card_id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        let mut event = transition_event(Transition {
            kind: HistoryKind::Epic,
            actor,
            reason: None,
            from_card: Some(task.card_status),
            to_card: task.card_status,
            from_agent: Some(task.agent_status),
            to_agent: task.agent_status,
            request_id: None,
            at,
        })?;
        event.from_epic_id = task.epic_id.clone();
        event.to_epic_id = next.clone();
        task.history.push(event);
        task.epic_id = next;
        task.updated_at = at;
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: reader::read_card(shared, project, card_id)?,
            changed: true,
        })
    }
}
