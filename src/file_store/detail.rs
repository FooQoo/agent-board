//! The data of one Detail stream, copied out of a project snapshot, and the events built from it.
//!
//! Nothing here reads a shared file except the headers of the images a block refers to, and
//! that happens while the events are built, before the first byte is sent.

use std::path::{Path, PathBuf};

use super::detail_refs::{AttachmentRef, attachment_refs};
pub use super::detail_version::{epic_version, task_versions};
use super::frontmatter::AcceptanceItem;
use super::image_size;
use super::layout;
use super::model::HistoryRecord;
use super::reader::ProjectSnapshot;
use super::validate::EpicId;
use crate::clock::format_utc;
use crate::domain::Attachment;
use crate::domain::markdown_blocks::{self, BlockKind as SplitKind};
use crate::error::AgboardError;
use crate::server::contracts::Version;
use crate::server::contracts::detail::{
    BlockKind, DetailAttachment, DetailEvent, DetailImage, DetailResource, ResourceId, Section,
    Versions,
};

/// What one Detail response is made from. It owns its data, so the index and the files can
/// change while the response is sent.
#[derive(Debug, Clone)]
pub struct DetailSnapshot {
    resource: DetailResource,
    id: ResourceId,
    project_id: String,
    project_dir: PathBuf,
    sections: Vec<Section>,
    versions: Versions,
    body: String,
    acceptance: Vec<AcceptanceItem>,
    history: Vec<HistoryRecord>,
    attachments: Vec<Attachment>,
}

impl DetailSnapshot {
    /// Copy task `id` out of `snapshot`. `shared` is only used to find image files later.
    pub fn task(
        shared: &Path,
        snapshot: &ProjectSnapshot,
        id: i64,
        sections: &[Section],
    ) -> Result<Self, AgboardError> {
        let task = snapshot
            .tasks
            .iter()
            .find(|task| task.id == id)
            .ok_or(AgboardError::TaskNotFound { id })?;
        let all = task_versions(task);
        Ok(Self {
            resource: DetailResource::Task,
            id: ResourceId::Task(id),
            project_id: snapshot.project.id.to_string(),
            project_dir: layout::project_dir(shared, &snapshot.project.id),
            sections: sections.to_vec(),
            versions: pick(sections, Some(all.document), Some(all.history)),
            body: task.body.clone(),
            acceptance: task.acceptance.clone(),
            history: task.history.clone(),
            attachments: task.attachments.clone(),
        })
    }

    /// Copy epic `id` out of `snapshot`. An epic has a document and no history.
    pub fn epic(
        shared: &Path,
        snapshot: &ProjectSnapshot,
        id: &EpicId,
        sections: &[Section],
    ) -> Result<Self, AgboardError> {
        let epic = snapshot
            .epics
            .iter()
            .find(|epic| epic.id == *id)
            .ok_or_else(|| AgboardError::EpicNotFound { id: id.to_string() })?;
        Ok(Self {
            resource: DetailResource::Epic,
            id: ResourceId::Epic(id.to_string()),
            project_id: snapshot.project.id.to_string(),
            project_dir: layout::project_dir(shared, &snapshot.project.id),
            sections: sections.to_vec(),
            versions: pick(sections, Some(epic_version(epic)), None),
            body: epic.body.clone(),
            acceptance: Vec::new(),
            history: Vec::new(),
            attachments: epic.attachments.clone(),
        })
    }

    pub fn versions(&self) -> &Versions {
        &self.versions
    }

    /// Every event of the stream, in order. Reads the headers of the images the blocks refer to.
    pub fn events(&self) -> Vec<DetailEvent> {
        let mut events = vec![DetailEvent::Start {
            resource: self.resource,
            id: self.id.clone(),
            project_id: self.project_id.clone(),
            sections: self.sections.clone(),
            versions: self.versions.clone(),
        }];
        for section in &self.sections {
            events.push(DetailEvent::SectionStart { section: *section });
            // The attachments event is the document's header, not an item.
            if *section == Section::Document {
                events.push(self.attachments_event());
            }
            let before = events.len();
            match section {
                Section::Document => self.document_events(&mut events),
                Section::History => self.history_events(&mut events),
            }
            events.push(DetailEvent::SectionEnd {
                section: *section,
                count: u32::try_from(events.len() - before).unwrap_or(u32::MAX),
            });
        }
        events.push(DetailEvent::Complete {
            versions: self.versions.clone(),
        });
        events
    }

    fn attachments_event(&self) -> DetailEvent {
        DetailEvent::Attachments {
            items: self
                .attachments
                .iter()
                .map(|attachment| DetailAttachment {
                    id: attachment.id.clone(),
                    name: attachment.name.clone(),
                    media_type: attachment.media_type.clone(),
                    size: attachment.size,
                    created_at: format_utc(attachment.created_at),
                })
                .collect(),
        }
    }

    fn document_events(&self, events: &mut Vec<DetailEvent>) {
        for block in markdown_blocks::split_blocks(&self.body) {
            let images = self.images_of(&block.text);
            events.push(DetailEvent::Block {
                kind: match block.kind {
                    SplitKind::Markdown => BlockKind::Markdown,
                    SplitKind::Mermaid => BlockKind::Mermaid,
                },
                text: block.text,
                images,
            });
        }
        for item in &self.acceptance {
            events.push(DetailEvent::Acceptance {
                id: item.id.clone(),
                text: item.text.clone(),
                done: item.done,
            });
        }
    }

    fn history_events(&self, events: &mut Vec<DetailEvent>) {
        for record in &self.history {
            events.push(DetailEvent::HistoryItem {
                at: format_utc(record.at),
                reason: record.reason.clone(),
            });
        }
    }

    /// The attachment URLs of this project that `text` mentions, each once, in order. The size
    /// is read for this resource's own images; any other URL goes without one.
    fn images_of(&self, text: &str) -> Vec<DetailImage> {
        let mut images: Vec<DetailImage> = Vec::new();
        for reference in attachment_refs(text, &self.project_id) {
            if images.iter().any(|image| image.src == reference.src) {
                continue;
            }
            let size = self
                .own_file(&reference)
                .and_then(|p| image_size::dimensions(&p));
            images.push(DetailImage {
                src: reference.src,
                width: size.map(|(width, _)| width),
                height: size.map(|(_, height)| height),
            });
        }
        images
    }

    /// The file of an attachment of this very task or epic, when it exists and no symbolic link
    /// leads to it.
    fn own_file(&self, reference: &AttachmentRef) -> Option<PathBuf> {
        let owned = match (&self.id, reference.tasks) {
            (ResourceId::Task(id), true) => reference.owner == id.to_string(),
            (ResourceId::Epic(id), false) => reference.owner == *id,
            _ => false,
        };
        if !owned {
            return None;
        }
        let attachment = self
            .attachments
            .iter()
            .find(|attachment| attachment.id == reference.attachment)?;
        let ext = layout::asset_extension(&attachment.media_type)?;
        let path = match &self.id {
            ResourceId::Task(id) => {
                layout::task_asset_path(&self.project_dir, *id, &attachment.id, ext).ok()?
            }
            ResourceId::Epic(id) => {
                let epic: EpicId = id.parse().ok()?;
                layout::epic_asset_path(&self.project_dir, &epic, &attachment.id, ext).ok()?
            }
        };
        let linked = layout::has_symlink_below(&self.project_dir, &path).ok()?;
        (!linked && path.is_file()).then_some(path)
    }
}

fn pick(sections: &[Section], document: Option<Version>, history: Option<Version>) -> Versions {
    Versions {
        document: document.filter(|_| sections.contains(&Section::Document)),
        history: history.filter(|_| sections.contains(&Section::History)),
    }
}
