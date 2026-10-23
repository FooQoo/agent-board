//! The Detail NDJSON stream of `.../tasks/{taskId}/detail` and `.../epics/{epicId}/detail`.
//! One JSON object per line, in this order: `start`, then for each requested section
//! `section-start`, its items, `section-end`, and finally `complete`.

use serde::{Deserialize, Serialize};

use super::Version;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Section {
    /// The body (as blocks) and, for a task, the acceptance conditions.
    Document,
    /// A task's history. An epic has none.
    History,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DetailResource {
    Task,
    Epic,
}

/// A task ID is an integer; an epic ID is a string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ResourceId {
    Task(i64),
    Epic(String),
}

/// The versions of the sections in the stream, computed from one snapshot. `start` and
/// `complete` carry the same value.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Versions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document: Option<Version>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history: Option<Version>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockKind {
    Markdown,
    Mermaid,
}

/// An image the block refers to. `src` is the same string as the URL in the block's text.
/// The size is absent when the file header cannot be read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DetailImage {
    pub src: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

/// One attachment of a task or an epic, as its `task.json` / `epic.json` records it. The
/// bytes are fetched from the attachment route.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DetailAttachment {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub size: i64,
    pub created_at: String,
}

/// One line of a Detail stream; `type` names the event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DetailEvent {
    Start {
        resource: DetailResource,
        id: ResourceId,
        project_id: String,
        sections: Vec<Section>,
        versions: Versions,
    },
    SectionStart {
        section: Section,
    },
    /// The attachments of the resource, once per `document` section: right after
    /// `section-start`, before the first block. It is not an item: `section-end.count` does not
    /// count it.
    Attachments {
        items: Vec<DetailAttachment>,
    },
    /// A top-level Markdown block of the document. Concatenating the blocks gives the body.
    Block {
        kind: BlockKind,
        text: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        images: Vec<DetailImage>,
    },
    /// One acceptance condition of a task, with its full text.
    Acceptance {
        id: String,
        text: String,
        done: bool,
    },
    HistoryItem {
        at: String,
        reason: String,
    },
    /// `count` is the number of item events between `section-start` and here.
    SectionEnd {
        section: Section,
        count: u32,
    },
    Complete {
        versions: Versions,
    },
}

impl DetailEvent {
    /// This event as one NDJSON line, with the trailing newline.
    pub fn to_line(&self) -> String {
        let mut line = serde_json::to_string(self).expect("a detail event serializes");
        line.push('\n');
        line
    }
}

/// The value of `?sections=` is invalid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidSections;

/// `document`, `history` or `document,history`; no value means both. Anything else is invalid.
pub fn parse_sections(raw: Option<&str>) -> Result<Vec<Section>, InvalidSections> {
    match raw {
        None | Some("document,history") => Ok(vec![Section::Document, Section::History]),
        Some("document") => Ok(vec![Section::Document]),
        Some("history") => Ok(vec![Section::History]),
        Some(_) => Err(InvalidSections),
    }
}
