use super::{AgboardError, FileAction};

impl AgboardError {
    /// One-line summary of what went wrong.
    pub fn message(&self) -> String {
        match self {
            AgboardError::ProjectNotFound { .. } => "project not found.".to_string(),
            AgboardError::FolderBoundElsewhere { .. } => {
                "this folder already belongs to another project.".to_string()
            }
            AgboardError::FolderUnbound { .. } => {
                "this folder is not bound to a project.".to_string()
            }
            AgboardError::BoundProjectMissing { .. } => {
                "the project bound to this folder no longer exists.".to_string()
            }
            AgboardError::ProjectNameExists { name } => {
                format!("project \"{name}\" already exists.")
            }
            AgboardError::TaskNotFound { id } => format!("task #{id} not found."),
            AgboardError::TaskArchived { id } => format!("task #{id} is archived."),
            AgboardError::TaskNotArchived { id } => format!("task #{id} is not archived."),
            AgboardError::ArchiveTargetsChanged => "archive targets changed.".into(),
            AgboardError::AttachmentNotFound { id } => format!("attachment {id} not found."),
            AgboardError::AttachmentLimitExceeded => "attachment limits were exceeded.".into(),
            AgboardError::EpicIdTaken { id } => format!("epic {id} already exists."),
            AgboardError::EpicNotFound { id } => format!("epic {id} not found."),
            AgboardError::EpicInUse { id } => format!("epic {id} is used by tasks."),
            AgboardError::InvalidArgument { message, .. } => message.clone(),
            AgboardError::InvalidValue { field, .. } => format!("{field} is invalid."),
            AgboardError::InvalidStateForColumn { id, state, .. } => {
                format!("cannot set #{id} to {}.", state.as_str())
            }
            AgboardError::InvalidStateForAssignee => "state is invalid for this assignee.".into(),
            AgboardError::TaskIsDraft { id } => {
                format!("task #{id} is a draft and read-only for agents.")
            }
            AgboardError::TaskIsDone { id } => {
                format!("task #{id} is done and read-only for agents.")
            }
            AgboardError::AcceptanceUnmet { id, unmet } => format!(
                "task #{id} has unmet acceptance conditions: {}.",
                unmet.join(", ")
            ),
            AgboardError::TaskNotDraft { id } => format!("task #{id} is not a draft."),
            AgboardError::InvalidStateForDraft { id, state } => {
                format!("cannot make #{id} a draft while it is {}.", state.as_str())
            }
            AgboardError::RequestChanged => "the pending request has changed.".into(),
            AgboardError::TaskStatusChanged { id, current } => {
                format!("task #{id} is now {}.", current.as_str())
            }
            AgboardError::OnboardingConflict { reason } => reason.clone(),
            AgboardError::OnboardingInvalid { reason } => reason.clone(),
            AgboardError::ConfirmationRequired { operation } => {
                format!("{operation} needs confirmation from a human.")
            }
            AgboardError::FileError { action, file, .. } => match action {
                FileAction::Read => format!("cannot read {file}."),
                FileAction::Write => format!("cannot write {file}."),
            },
            AgboardError::FileInvalid { file, .. } => format!("{file} is not valid."),
            AgboardError::FileUnreadable { file, .. } => format!("cannot read {file}."),
            AgboardError::FormatUnsupported { file, .. } => {
                format!("{file} has an unsupported format version.")
            }
            AgboardError::RequestChoiceUnknown { .. } => {
                "the choice is not part of this request.".into()
            }
            AgboardError::DatabaseBusy => "the board is busy.".to_string(),
            AgboardError::DatabaseError { .. } => "cannot open the board.".to_string(),
            AgboardError::AlreadyServing { .. } => "the board is already being served.".to_string(),
            AgboardError::PortInUse { port } => format!("port {port} is already in use."),
            AgboardError::BoardUnavailable { .. } => "the board is unavailable.".to_string(),
            AgboardError::CursorInvalid { .. } => "the cursor is invalid.".to_string(),
            AgboardError::WaitTimeout => "no board change before the timeout.".to_string(),
            AgboardError::DocsPathInvalid { .. } => "the document path is invalid.".to_string(),
            AgboardError::DocsNotFound { path } => format!("document {path} not found."),
            AgboardError::DocsNotMarkdown { path } => format!("{path} is not a Markdown file."),
            AgboardError::DocsTooLarge { path, .. } => format!("{path} is too large."),
            AgboardError::DocsNotUtf8 { path } => format!("{path} is not UTF-8 text."),
            AgboardError::DocsAssetType { path } => format!("{path} is not a supported image."),
            AgboardError::DocsNotImplemented => {
                "this document operation is not available yet.".to_string()
            }
            AgboardError::DocsOpenFailed { .. } => "cannot open the Docs folder.".to_string(),
        }
    }
}
