//! The change sets the reloader announces: what changed in which resource, and where the
//! sets are sent.

use std::sync::Arc;

use super::Projection;
use super::diff::diff;
use crate::domain::ProjectId;

/// The kind of thing that changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resource {
    Task,
    Epic,
    Project,
}

/// The ID of a changed resource: a task number, or the name of an epic or a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResourceId {
    Task(i64),
    Named(String),
}

/// What changed in a resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Facet {
    Summary,
    Document,
    History,
    Deleted,
}

/// One changed resource and the facets that changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceChange {
    pub resource: Resource,
    pub id: ResourceId,
    pub facets: Vec<Facet>,
}

/// Every change one reload found in one project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeSet {
    pub project_id: ProjectId,
    pub changes: Vec<ResourceChange>,
}

/// Where the reloader sends the change sets it finds. Cheap to clone.
#[derive(Clone)]
pub struct ChangeSink(Arc<dyn Fn(ChangeSet) + Send + Sync>);

impl ChangeSink {
    pub fn new(send: impl Fn(ChangeSet) + Send + Sync + 'static) -> ChangeSink {
        ChangeSink(Arc::new(send))
    }

    pub fn send(&self, set: ChangeSet) {
        (self.0)(set);
    }
}

impl From<tokio::sync::broadcast::Sender<ChangeSet>> for ChangeSink {
    fn from(sender: tokio::sync::broadcast::Sender<ChangeSet>) -> ChangeSink {
        ChangeSink::new(move |set| {
            let _ = sender.send(set);
        })
    }
}

impl std::fmt::Debug for ChangeSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ChangeSink")
    }
}

pub(crate) fn project_change(id: &ProjectId, facet: Facet) -> ChangeSet {
    ChangeSet {
        project_id: id.clone(),
        changes: vec![ResourceChange {
            resource: Resource::Project,
            id: ResourceId::Named(id.to_string()),
            facets: vec![facet],
        }],
    }
}

/// The changes of a project that was read: its tasks and epics against the earlier projection,
/// and the project itself when it is new, was unreadable before, or has a new name.
pub(crate) fn ready_changes(
    old: Option<&Projection>,
    new: &Projection,
    was_invalid: bool,
) -> Vec<ResourceChange> {
    let project = ResourceChange {
        resource: Resource::Project,
        id: ResourceId::Named(new.project_id.clone()),
        facets: vec![Facet::Summary],
    };
    match old {
        None => vec![project],
        Some(old) => {
            let mut changes = diff(old, new);
            if was_invalid || old.project_name != new.project_name {
                changes.insert(0, project);
            }
            changes
        }
    }
}

/// The changes when a project can no longer be read: the project, and everything it had.
pub(crate) fn invalid_changes(old: Option<&Projection>, was_invalid: bool) -> Vec<ResourceChange> {
    let Some(old) = old else {
        return Vec::new();
    };
    if was_invalid {
        return Vec::new();
    }
    let mut changes = vec![ResourceChange {
        resource: Resource::Project,
        id: ResourceId::Named(old.project_id.clone()),
        facets: vec![Facet::Summary],
    }];
    changes.extend(super::diff::invalidate_all(old));
    changes
}
