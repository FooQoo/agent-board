//! The versions of a Detail stream's sections: hashes of the parsed content, so a save that
//! changes nothing the reader shows leaves them as they were.

use sha2::{Digest, Sha256};

use super::model::{EpicView, HistoryRecord, TaskView};
use crate::clock::format_utc;
use crate::domain::Attachment;
use crate::server::contracts::{DetailVersions, Version};

/// A version is the first 16 bytes of a SHA-256 as 32 lowercase hexadecimal digits, the same
/// form as a project's content version.
struct VersionHasher(Sha256);

impl VersionHasher {
    fn new(label: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(label.as_bytes());
        hasher.update([0]);
        Self(hasher)
    }

    /// Each field is followed by a separator and its length-free text, so two different field
    /// lists never give the same bytes.
    fn field(&mut self, text: &str) {
        self.0.update(text.len().to_string().as_bytes());
        self.0.update([b':']);
        self.0.update(text.as_bytes());
        self.0.update([0]);
    }

    fn finish(self) -> Version {
        self.0.finalize()[..16]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}

fn hash_attachments(hasher: &mut VersionHasher, attachments: &[Attachment]) {
    hasher.field(&attachments.len().to_string());
    for attachment in attachments {
        hasher.field(&attachment.id);
        hasher.field(&attachment.media_type);
        hasher.field(&attachment.size.to_string());
    }
}

/// The versions of a task's two sections. The document version covers the body, the
/// acceptance conditions and the image list; the history version covers every entry.
pub fn task_versions(task: &TaskView) -> DetailVersions {
    let mut document = VersionHasher::new("task-document");
    document.field(&task.body);
    document.field(&task.acceptance.len().to_string());
    for item in &task.acceptance {
        document.field(&item.id);
        document.field(&item.text);
        document.field(if item.done { "done" } else { "open" });
    }
    hash_attachments(&mut document, &task.attachments);
    DetailVersions {
        document: document.finish(),
        history: history_version(&task.history),
    }
}

fn history_version(history: &[HistoryRecord]) -> Version {
    let mut hasher = VersionHasher::new("task-history");
    hasher.field(&history.len().to_string());
    for record in history {
        hasher.field(&format_utc(record.at));
        hasher.field(&record.reason);
    }
    hasher.finish()
}

/// The version of an epic's document: its body and its image list.
pub fn epic_version(epic: &EpicView) -> Version {
    let mut hasher = VersionHasher::new("epic-document");
    hasher.field(&epic.body);
    hash_attachments(&mut hasher, &epic.attachments);
    hasher.finish()
}
