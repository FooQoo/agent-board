//! The SQLite-era shapes of a board: a revision counter and the cursor
//! `<ProjectId>:<revision>`. Only the SQLite store and its transfer code use
//! them; the shared-file reads use `domain::ChangeCursor`, which is keyed by
//! content version. This module goes away with the store.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::domain::{BoardMeta, Card, ProjectId, ProjectMeta};
use crate::error::SkanError;

/// A point in one project's SQLite change stream: `<ProjectId>:<revision>`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RevisionCursor {
    pub project_id: ProjectId,
    pub revision: i64,
}

impl RevisionCursor {
    pub fn new(project_id: ProjectId, revision: i64) -> Result<RevisionCursor, SkanError> {
        if revision < 0 {
            return Err(SkanError::InvalidValue {
                field: "cursor".into(),
                reason: "A cursor revision cannot be negative.".into(),
            });
        }
        Ok(RevisionCursor {
            project_id,
            revision,
        })
    }
}

impl FromStr for RevisionCursor {
    type Err = SkanError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let bad = || SkanError::InvalidValue {
            field: "cursor".into(),
            reason: "A cursor looks like <project-id>:<revision>.".into(),
        };
        let (id, revision) = s.split_once(':').ok_or_else(bad)?;
        let project_id: ProjectId = id.parse().map_err(|_| bad())?;
        let canonical = !revision.is_empty()
            && revision.bytes().all(|b| b.is_ascii_digit())
            && (revision == "0" || !revision.starts_with('0'));
        if !canonical {
            return Err(bad());
        }
        let revision: i64 = revision.parse().map_err(|_| bad())?;
        Ok(RevisionCursor {
            project_id,
            revision,
        })
    }
}

impl fmt::Display for RevisionCursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.project_id, self.revision)
    }
}

impl Serialize for RevisionCursor {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for RevisionCursor {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        text.parse()
            .map_err(|e: SkanError| serde::de::Error::custom(e.reason()))
    }
}

/// One project's board read in a single transaction: the project, its board
/// metadata, revision, the cursor for that revision and every card with its
/// full history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSnapshot {
    pub project: ProjectMeta,
    pub board: BoardMeta,
    pub revision: i64,
    pub cursor: RevisionCursor,
    pub cards: Vec<Card>,
}

/// Every project's board read in one transaction, ordered by project name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllBoardsSnapshot {
    pub catalog_revision: i64,
    pub projects: Vec<BoardSnapshot>,
}

/// The SQLite project list with its catalog revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCatalog {
    pub projects: Vec<ProjectMeta>,
    pub catalog_revision: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn revision_cursor_round_trips_and_rejects_bare_integers() {
        let cursor: RevisionCursor = format!("{ID}:42").parse().unwrap();
        assert_eq!(cursor.revision, 42);
        assert_eq!(cursor.to_string(), format!("{ID}:42"));
        assert!(RevisionCursor::from_str("42").is_err());
        assert!(RevisionCursor::from_str(&format!("{ID}:01")).is_err());
        assert!(serde_json::from_str::<RevisionCursor>("42").is_err());
    }
}
