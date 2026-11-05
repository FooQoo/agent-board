use thiserror::Error;

use crate::domain::{Column, RunState};

/// Whether a file operation was a read or a write (for `file_error`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileAction {
    Read,
    Write,
}

/// Every error `agboard` can report. Each variant maps to one error code in the
/// design's error table.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{}", self.message())]
pub enum AgboardError {
    /// `project` is the name or ID the caller used to look the project up.
    ProjectNotFound {
        project: String,
    },
    ProjectNameExists {
        name: String,
    },
    /// The folder already belongs to another project.
    FolderBoundElsewhere {
        folder: String,
    },
    /// No bound folder contains the folder the command starts from.
    FolderUnbound {
        folder: String,
    },
    /// The folder's bound project was deleted; nothing is guessed.
    BoundProjectMissing {
        folder: String,
    },
    TaskNotFound {
        id: i64,
    },
    TaskArchived {
        id: i64,
    },
    TaskNotArchived {
        id: i64,
    },
    ArchiveTargetsChanged,
    AttachmentNotFound {
        id: String,
    },
    AttachmentLimitExceeded,
    EpicIdTaken {
        id: String,
    },
    EpicNotFound {
        id: String,
    },
    /// Tasks (archived ones included) still refer to the epic.
    EpicInUse {
        id: String,
    },
    /// `message` is the argument parser's message. `command` is the
    /// subcommand name used in the reason (`None` for the top level).
    InvalidArgument {
        message: String,
        command: Option<String>,
    },
    InvalidValue {
        field: String,
        reason: String,
    },
    InvalidStateForColumn {
        id: i64,
        state: RunState,
        column: Column,
    },
    InvalidStateForAssignee,
    /// The task is a draft: agents and the CLI cannot change it.
    TaskIsDraft {
        id: i64,
    },
    /// The epic is a draft: the CLI cannot change it.
    EpicIsDraft {
        id: String,
    },
    /// An agent tried to change a completed task.
    TaskIsDone {
        id: i64,
    },
    /// An agent tried to move a task to Done while these conditions are unmet.
    AcceptanceUnmet {
        id: i64,
        unmet: Vec<String>,
    },
    /// A draft operation was applied to a task that is not a draft.
    TaskNotDraft {
        id: i64,
    },
    /// Only tasks whose agent status is idle can become drafts.
    InvalidStateForDraft {
        id: i64,
        state: RunState,
    },
    RequestChanged,
    /// A move named the status it started from, and the task is no longer there.
    TaskStatusChanged {
        id: i64,
        current: Column,
    },
    /// The guide's state moved on: a stale revision, another tab's lease, or another run.
    OnboardingConflict {
        reason: String,
    },
    /// A guide command that the current step does not allow, or a malformed guide input.
    OnboardingInvalid {
        reason: String,
    },
    ConfirmationRequired {
        operation: String,
    },
    FileError {
        action: FileAction,
        file: String,
        reason: String,
    },
    /// A shared file does not follow the format. `file` is relative to the
    /// shared directory and `field` names the item at fault (may be empty).
    FileInvalid {
        file: String,
        field: String,
        reason: String,
    },
    /// A shared file could not be read at all.
    FileUnreadable {
        file: String,
        reason: String,
    },
    /// A shared file declares a `formatVersion` this build does not read.
    FormatUnsupported {
        file: String,
        version: String,
        expected: u32,
    },
    /// The answer names a choice that is not part of the pending request.
    RequestChoiceUnknown {
        request_id: String,
        choice_id: String,
    },
    DatabaseBusy,
    DatabaseError {
        reason: String,
    },
    AlreadyServing {
        port: u16,
    },
    PortInUse {
        port: u16,
    },
    /// `agboard wait` could not read the board or reach the server.
    BoardUnavailable {
        reason: String,
    },
    /// The `--after` cursor does not fit the project or the board.
    CursorInvalid {
        reason: String,
    },
    /// `agboard wait` reached its `--timeout` with no change.
    WaitTimeout,
    /// A Docs path that cannot name a file under the Docs root.
    DocsPathInvalid {
        reason: String,
    },
    DocsNotFound {
        path: String,
    },
    /// The Docs file API only serves `.md` and `.mdx` files.
    DocsNotMarkdown {
        path: String,
    },
    DocsTooLarge {
        path: String,
        limit: u64,
    },
    DocsNotUtf8 {
        path: String,
    },
    /// The Docs image API serves only PNG, JPEG, WebP, GIF, AVIF and SVG.
    DocsAssetType {
        path: String,
    },
    DocsNotImplemented,
    /// The Docs folder could not be opened in the file manager.
    DocsOpenFailed {
        reason: String,
    },
}

mod code;
mod message;
mod reason;

#[cfg(test)]
mod tests;
