//! The SSE `changed` payload. `ready` (build) and `preferences` are unchanged and not part of
//! this contract.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Changed {
    /// Identifies this server start; a new value tells clients that `seq` began again.
    pub instance_id: String,
    /// Grows by one for every `changed` of this instance. A gap means a missed event.
    pub seq: u64,
    pub project_id: String,
    pub changes: Vec<Change>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Change {
    pub resource: ChangeResource,
    pub id: ChangeId,
    pub facets: Vec<Facet>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeResource {
    Task,
    Epic,
    /// The project list changed: a project was created, renamed or deleted.
    Project,
}

/// A task ID is an integer; an epic ID and a project ID are strings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChangeId {
    Task(i64),
    Named(String),
}

/// What changed. `summary`: title, status, position, epic, pending question, acceptance counts.
/// `document`: the body and the acceptance text. `history`: the history. `deleted`: removal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Facet {
    Summary,
    Document,
    History,
    Deleted,
}

impl Changed {
    /// A defect in the payload's meaning, or `None` when it is well formed: the ID type matches
    /// the resource, no facet list is empty or repeated, and a project has only `summary` or
    /// `deleted`.
    pub fn problem(&self) -> Option<String> {
        for change in &self.changes {
            let id_ok = matches!(
                (change.resource, &change.id),
                (ChangeResource::Task, ChangeId::Task(_))
                    | (
                        ChangeResource::Epic | ChangeResource::Project,
                        ChangeId::Named(_)
                    )
            );
            if !id_ok {
                return Some(format!("the ID does not fit the {:?}", change.resource));
            }
            if change.facets.is_empty() {
                return Some("a change has no facets".into());
            }
            for (i, facet) in change.facets.iter().enumerate() {
                if change.facets[..i].contains(facet) {
                    return Some(format!("the facet {facet:?} is repeated"));
                }
                let project_facet = matches!(facet, Facet::Summary | Facet::Deleted);
                if change.resource == ChangeResource::Project && !project_facet {
                    return Some("a project change has only summary or deleted".into());
                }
            }
        }
        None
    }
}
