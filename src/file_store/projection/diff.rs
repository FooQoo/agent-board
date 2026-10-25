//! Comparing two projections of one project.

use std::collections::BTreeSet;

use super::changes::{Facet, Resource, ResourceChange, ResourceId};
use super::{EpicProjection, Projection, TaskProjection};

const ALL_TASK_FACETS: [Facet; 3] = [Facet::Summary, Facet::Document, Facet::History];
const ALL_EPIC_FACETS: [Facet; 2] = [Facet::Summary, Facet::Document];

fn change(resource: Resource, id: ResourceId, facets: &[Facet]) -> ResourceChange {
    ResourceChange {
        resource,
        id,
        facets: facets.to_vec(),
    }
}

/// The changes from `old` to `new` inside one project.
///
/// A resource that was added is changed in every facet; one that is gone is `deleted`. A
/// resource that exists on both sides is compared by its parsed data. When a file of the
/// resource is defective on either side and anything differs, the data cannot be trusted to
/// say which facet changed, so every facet is changed. A resource that cannot be read at all
/// counts as present, with the digest of its raw files as its content.
pub fn diff(old: &Projection, new: &Projection) -> Vec<ResourceChange> {
    let mut changes = Vec::new();

    let task_ids: BTreeSet<i64> = [old, new]
        .iter()
        .flat_map(|p| {
            p.tasks
                .iter()
                .map(|t| t.fields.id)
                .chain(p.broken_tasks.keys().copied())
        })
        .collect();
    for id in task_ids {
        let before = TaskState::of(old, id);
        let after = TaskState::of(new, id);
        if let Some(facets) = task_facets(&before, &after) {
            changes.push(change(Resource::Task, ResourceId::Task(id), &facets));
        }
    }

    let epic_ids: BTreeSet<&str> = [old, new]
        .iter()
        .flat_map(|p| {
            p.epics
                .iter()
                .map(|e| e.fields.id.as_str())
                .chain(p.broken_epics.keys().map(String::as_str))
        })
        .collect();
    for id in epic_ids {
        let before = EpicState::of(old, id);
        let after = EpicState::of(new, id);
        if let Some(facets) = epic_facets(&before, &after) {
            changes.push(change(
                Resource::Epic,
                ResourceId::Named(id.to_string()),
                &facets,
            ));
        }
    }
    changes
}

enum TaskState<'a> {
    Absent,
    Broken(&'a str),
    Read(&'a TaskProjection),
}

impl<'a> TaskState<'a> {
    fn of(projection: &'a Projection, id: i64) -> TaskState<'a> {
        if let Some(task) = projection.tasks.iter().find(|t| t.fields.id == id) {
            TaskState::Read(task)
        } else if let Some(digest) = projection.broken_tasks.get(&id) {
            TaskState::Broken(digest)
        } else {
            TaskState::Absent
        }
    }
}

fn task_facets(before: &TaskState<'_>, after: &TaskState<'_>) -> Option<Vec<Facet>> {
    match (before, after) {
        (TaskState::Absent, TaskState::Absent) => None,
        (_, TaskState::Absent) => Some(vec![Facet::Deleted]),
        (TaskState::Absent, _) => Some(ALL_TASK_FACETS.to_vec()),
        (TaskState::Broken(a), TaskState::Broken(b)) => (a != b).then(|| ALL_TASK_FACETS.to_vec()),
        (TaskState::Broken(_), _) | (_, TaskState::Broken(_)) => Some(ALL_TASK_FACETS.to_vec()),
        (TaskState::Read(a), TaskState::Read(b)) => {
            let mut facets = Vec::new();
            if a.summary_hash != b.summary_hash {
                facets.push(Facet::Summary);
            }
            if a.document_version != b.document_version {
                facets.push(Facet::Document);
            }
            if a.history_version != b.history_version {
                facets.push(Facet::History);
            }
            if facets.is_empty() {
                None
            } else if a.damaged || b.damaged {
                Some(ALL_TASK_FACETS.to_vec())
            } else {
                Some(facets)
            }
        }
    }
}

enum EpicState<'a> {
    Absent,
    Broken(&'a str),
    Read(&'a EpicProjection),
}

impl<'a> EpicState<'a> {
    fn of(projection: &'a Projection, id: &str) -> EpicState<'a> {
        if let Some(epic) = projection.epics.iter().find(|e| e.fields.id == id) {
            EpicState::Read(epic)
        } else if let Some(digest) = projection.broken_epics.get(id) {
            EpicState::Broken(digest)
        } else {
            EpicState::Absent
        }
    }
}

fn epic_facets(before: &EpicState<'_>, after: &EpicState<'_>) -> Option<Vec<Facet>> {
    match (before, after) {
        (EpicState::Absent, EpicState::Absent) => None,
        (_, EpicState::Absent) => Some(vec![Facet::Deleted]),
        (EpicState::Absent, _) => Some(ALL_EPIC_FACETS.to_vec()),
        (EpicState::Broken(a), EpicState::Broken(b)) => (a != b).then(|| ALL_EPIC_FACETS.to_vec()),
        (EpicState::Broken(_), _) | (_, EpicState::Broken(_)) => Some(ALL_EPIC_FACETS.to_vec()),
        (EpicState::Read(a), EpicState::Read(b)) => {
            let mut facets = Vec::new();
            if a.summary_hash != b.summary_hash {
                facets.push(Facet::Summary);
            }
            if a.document_version != b.document_version {
                facets.push(Facet::Document);
            }
            if facets.is_empty() {
                None
            } else if a.damaged || b.damaged {
                Some(ALL_EPIC_FACETS.to_vec())
            } else {
                Some(facets)
            }
        }
    }
}

/// Every resource of a projection, changed in every facet that can be judged: what is
/// announced when the project can no longer be read.
pub fn invalidate_all(projection: &Projection) -> Vec<ResourceChange> {
    let tasks = projection
        .tasks
        .iter()
        .map(|task| task.fields.id)
        .chain(projection.broken_tasks.keys().copied())
        .map(|id| change(Resource::Task, ResourceId::Task(id), &ALL_TASK_FACETS));
    let epics = projection
        .epics
        .iter()
        .map(|epic| epic.fields.id.clone())
        .chain(projection.broken_epics.keys().cloned())
        .map(|id| change(Resource::Epic, ResourceId::Named(id), &ALL_EPIC_FACETS));
    tasks.chain(epics).collect()
}
