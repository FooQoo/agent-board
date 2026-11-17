use thiserror::Error;

use crate::domain::{Column, RunState};

/// Whether a file operation was a read or a write (for `file_error`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileAction {
    Read,
    Write,
}

/// What holds a port that `serve` could not take.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortHolder {
    /// Nothing answered the question.
    Unknown,
    /// An Agent Board server of another data directory, with its process ID.
    AgentBoard { pid: u32 },
    /// Something that is not an Agent Board server.
    OtherProgram,
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
    /// The task is an AI draft: it waits for a person to start it.
    TaskIsAiDraft {
        id: i64,
    },
    /// The epic is a draft: the CLI cannot change it.
    EpicIsDraft {
        id: String,
    },
    /// A finalize was asked of an AI draft; only starting it clears the draft.
    AiDraftNeedsStart {
        /// The task or epic, as named to the reader: `task #5`, `epic EPIC-1`.
        target: String,
    },
    /// An agent asked for something only a person may do.
    HumanOnly {
        action: String,
    },
    /// A person asked for something only an agent may do.
    AiOnly {
        action: String,
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
    /// An agent tried to run or finish a task that waits for answers to its questions.
    QuestionsUnanswered {
        id: i64,
    },
    /// These questions were answered before; nothing was written.
    QuestionAnswered {
        ids: Vec<String>,
    },
    /// These questions belong to a withdrawn request; nothing was written.
    QuestionWithdrawn {
        ids: Vec<String>,
    },
    /// A start was refused: these questions about the draft have no reply yet. Nothing was written.
    StartBlockedByQuestions {
        ids: Vec<String>,
    },
    /// No question or request has this ID.
    MessageNotFound {
        id: String,
    },
    /// The message has its reply, so it can no longer be withdrawn.
    MessageClosed {
        id: String,
    },
    /// The command is for the other kind of message: a question was named where a request
    /// belongs, or the other way around.
    MessageTypeMismatch {
        id: String,
        expected: String,
    },
    /// The request was accepted before; nothing was written.
    RequestAccepted {
        id: String,
    },
    /// The request was withdrawn, so nobody can accept it.
    RequestWithdrawn {
        id: String,
    },
    /// A move named the status it started from, and the task is no longer there.
    TaskStatusChanged {
        id: i64,
        current: Column,
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
    /// The answer names a choice that is not part of the question.
    ChoiceUnknown {
        question_id: String,
        choice_id: String,
    },
    DatabaseBusy,
    DatabaseError {
        reason: String,
    },
    /// A server for the same data directory is running; `auto` when the CLI started it.
    AlreadyServing {
        port: u16,
        auto: bool,
    },
    /// The port is taken; `holder` says by what, when that could be found out.
    PortInUse {
        port: u16,
        holder: PortHolder,
    },
    /// The OS or a sandbox does not allow listening on or connecting to 127.0.0.1.
    LocalNetworkDenied,
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
    /// `agboard remote` has no ready ngrok connection to report.
    RemoteUnavailable {
        reason: String,
    },
    /// `agboard open` could not start the program that opens the browser.
    BrowserOpenFailed {
        url: String,
        reason: String,
    },
}

mod code;
mod message;
mod reason;

#[cfg(test)]
mod tests;
