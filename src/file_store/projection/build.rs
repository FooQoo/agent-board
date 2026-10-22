//! Building a projection from a parsed project snapshot.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::detail_versions;
use super::{
    EpicProgress, EpicProjection, EpicSummaryFields, Projection, TaskProjection, TaskSummaryFields,
};
use crate::file_store::index::hex_prefix;
use crate::file_store::layout;
use crate::file_store::model::{EpicView, TaskView};
use crate::file_store::reader::ProjectSnapshot;
use crate::file_store::validate::EpicId;

/// The first 16 bytes of the SHA-256 of a value's JSON, in hexadecimal.
fn digest<T: Serialize + ?Sized>(value: &T) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    hex_prefix(&Sha256::digest(bytes))
}

fn task_fields(task: &TaskView) -> TaskSummaryFields {
    TaskSummaryFields {
        id: task.id,
        title: task.title.clone(),
        task_status: task.task_status,
        agent_status: task.agent_status,
        assignee: task.assignee,
        is_draft: task.is_draft,
        position: task.position,
        epic_id: task.epic_id.clone(),
        acceptance_done: task.acceptance.iter().filter(|item| item.done).count() as u32,
        acceptance_total: task.acceptance.len() as u32,
        updated_at: crate::clock::format_utc(task.updated_at),
        pending_request_id: task.pending_request_id.clone(),
        pending_reason: task.pending_reason.clone(),
        pending_choices: task.pending_choices.clone(),
        task_status_changed_at: crate::clock::format_utc(task.task_status_changed_at),
        agent_status_changed_at: crate::clock::format_utc(task.agent_status_changed_at),
        onboarding_sample: task
            .onboarding_sample
            .as_ref()
            .map(|sample| (sample.run_id.clone(), sample.ordinal)),
    }
}

fn task_projection(task: &TaskView, damaged: bool) -> TaskProjection {
    let fields = task_fields(task);
    let archived = task.archived_at.is_some();
    // The same values the Detail stream reports.
    let document_version = detail_versions::task_document(task);
    let history_version = detail_versions::task_history(&task.history);
    TaskProjection {
        // `updatedAt` is a Summary field and moves with every edit of the card, but it has only
        // second precision. The two content versions stand in for it, so an edit within the
        // same second as the last one is still a change of the Summary. The archive state has
        // no Summary field of its own and is part of the hash as well.
        summary_hash: digest(&(&fields, archived, &document_version, &history_version)),
        document_version,
        history_version,
        fields,
        archived,
        damaged,
    }
}

fn epic_projection(epic: &EpicView, progress: EpicProgress, damaged: bool) -> EpicProjection {
    let fields = EpicSummaryFields {
        id: epic.id.as_str().to_string(),
        name: epic.name.clone(),
        color: epic.color.clone(),
        is_draft: epic.is_draft,
    };
    EpicProjection {
        // The progress follows the tasks, which announce their own changes.
        summary_hash: digest(&fields),
        document_version: detail_versions::epic_document(epic),
        fields,
        progress,
        damaged,
    }
}

/// The task or epic that a defect names, from the file label (`.../tasks/<n>/TASK.md`).
fn owner_of(file: &str, folder: &str) -> Option<String> {
    let mut parts = file.split('/');
    parts.find(|part| *part == folder)?;
    parts.next().map(str::to_string)
}

fn epic_progress(epic: &EpicView, tasks: &[TaskView]) -> EpicProgress {
    let mut progress = EpicProgress::default();
    for task in tasks {
        if task.epic_id.as_deref() != Some(epic.id.as_str()) {
            continue;
        }
        if task.archived_at.is_some() {
            progress.archived += 1;
        } else {
            match task.task_status {
                crate::domain::Column::Todo => progress.todo += 1,
                crate::domain::Column::Doing => progress.doing += 1,
                crate::domain::Column::Done => progress.done += 1,
            }
        }
        progress.total += 1;
    }
    progress
}

/// A digest of the raw files of something that could not be read, so a change to a broken
/// file is still a change.
fn raw_digest(files: &[std::path::PathBuf]) -> String {
    let parts: Vec<Option<Vec<u8>>> = files.iter().map(|path| fs::read(path).ok()).collect();
    digest(&parts)
}

/// Build the projection of a snapshot. `shared` is read only for the files of a task or an epic
/// that the snapshot could not read at all.
pub fn project(shared: &Path, snapshot: &ProjectSnapshot) -> Projection {
    let project_id = snapshot.project.id.to_string();
    let project_dir = layout::project_dir(shared, &snapshot.project.id);

    let mut damaged_tasks: BTreeSet<i64> = BTreeSet::new();
    let mut damaged_epics: BTreeSet<String> = BTreeSet::new();
    for problem in &snapshot.problems {
        if let Some(n) = owner_of(&problem.file, "tasks").and_then(|n| n.parse().ok()) {
            damaged_tasks.insert(n);
        }
        if let Some(name) = owner_of(&problem.file, "epics") {
            damaged_epics.insert(name);
        }
    }

    let tasks: Vec<TaskProjection> = snapshot
        .tasks
        .iter()
        .map(|task| task_projection(task, damaged_tasks.contains(&task.id)))
        .collect();
    let epics: Vec<EpicProjection> = snapshot
        .epics
        .iter()
        .map(|epic| {
            epic_projection(
                epic,
                epic_progress(epic, &snapshot.tasks),
                damaged_epics.contains(epic.id.as_str()),
            )
        })
        .collect();

    let broken_tasks = damaged_tasks
        .iter()
        .filter(|id| !snapshot.tasks.iter().any(|task| task.id == **id))
        .map(|id| {
            let dir = layout::task_dir(&project_dir, *id);
            let digest = raw_digest(&[layout::task_json(&dir), layout::task_md(&dir)]);
            (*id, digest)
        })
        .collect();
    let broken_epics = damaged_epics
        .iter()
        .filter(|name| {
            !snapshot
                .epics
                .iter()
                .any(|epic| epic.id.as_str() == name.as_str())
        })
        .filter_map(|name| {
            let dir = layout::epic_dir(&project_dir, &EpicId::normalize(name).ok()?);
            let digest = raw_digest(&[layout::epic_file(&dir), layout::epic_document(&dir)]);
            Some((name.clone(), digest))
        })
        .collect();

    let problems = snapshot.problems.clone();
    let version = digest(&(
        &project_id,
        &snapshot.project.name,
        tasks
            .iter()
            .filter(|task| !task.archived)
            .map(|task| {
                (
                    task.fields.id,
                    &task.summary_hash,
                    &task.document_version,
                    &task.history_version,
                )
            })
            .collect::<Vec<_>>(),
        epics
            .iter()
            .map(|epic| {
                (
                    &epic.fields.id,
                    &epic.summary_hash,
                    epic.progress,
                    &epic.document_version,
                )
            })
            .collect::<Vec<_>>(),
        problems
            .iter()
            .map(|p| (&p.file, &p.field, &p.reason))
            .collect::<Vec<_>>(),
    ));
    Projection {
        project_id,
        project_name: snapshot.project.name.clone(),
        version,
        tasks,
        epics,
        problems,
        broken_tasks,
        broken_epics,
    }
}
