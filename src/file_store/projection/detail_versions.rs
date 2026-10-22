//! The versions of the Detail sections, as the Summary reports them (`detailVersions`).
//!
//! The Detail stream carries the same values in its `start` and `complete`, so the rule must be
//! the same one: the field list, the order, and the length-prefixed encoding below are the
//! rule of `file_store::detail_version`, and a change to either side changes both.

use sha2::{Digest, Sha256};

use crate::clock::format_utc;
use crate::domain::Attachment;
use crate::file_store::model::{EpicView, HistoryRecord, TaskView};

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

    fn finish(self) -> String {
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

/// The document version of a task: the body, the acceptance conditions and the image list.
pub(super) fn task_document(task: &TaskView) -> String {
    let mut document = VersionHasher::new("task-document");
    document.field(&task.body);
    document.field(&task.acceptance.len().to_string());
    for item in &task.acceptance {
        document.field(&item.id);
        document.field(&item.text);
        document.field(if item.done { "done" } else { "open" });
    }
    hash_attachments(&mut document, &task.attachments);
    document.finish()
}

/// The history version of a task: every entry.
pub(super) fn task_history(history: &[HistoryRecord]) -> String {
    let mut hasher = VersionHasher::new("task-history");
    hasher.field(&history.len().to_string());
    for record in history {
        hasher.field(&format_utc(record.at));
        hasher.field(&record.reason);
    }
    hasher.finish()
}

/// The version of an epic's document: its body and its image list.
pub(super) fn epic_document(epic: &EpicView) -> String {
    let mut hasher = VersionHasher::new("epic-document");
    hasher.field(&epic.body);
    hash_attachments(&mut hasher, &epic.attachments);
    hasher.finish()
}
