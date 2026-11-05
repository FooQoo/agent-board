use super::AgboardError;

impl AgboardError {
    /// What to do about it, or why it happened.
    pub fn reason(&self) -> String {
        match self {
            AgboardError::ProjectNotFound { project } => format!(
                "No project matches \"{project}\". Run \"agboard project ls\" to see the projects."
            ),
            AgboardError::ProjectNameExists { .. } => {
                "Project names must be unique. Choose another name.".to_string()
            }
            AgboardError::FolderBoundElsewhere { .. } => {
                "A folder belongs to one project. Choose another folder.".to_string()
            }
            AgboardError::FolderUnbound { .. } => {
                "Create a project here with \"agboard project create NAME\", or bind this folder with \"agboard project bind NAME\".".to_string()
            }
            AgboardError::BoundProjectMissing { .. } => {
                "Bind this folder to a project with \"agboard project bind NAME\".".to_string()
            }
            AgboardError::TaskNotFound { id } => {
                format!("No task has ID {id}. Run \"agboard ls\" to see the tasks.")
            }
            AgboardError::TaskArchived { .. } => "Restore the task before editing it.".into(),
            AgboardError::TaskNotArchived { .. } => "Only an archived task can be deleted here.".into(),
            AgboardError::ArchiveTargetsChanged => "Read the latest Done tasks and confirm the archive again.".into(),
            AgboardError::AttachmentNotFound { .. } => "The attachment does not belong to this task.".into(),
            AgboardError::AttachmentLimitExceeded => "A task may contain at most 20 images and 50 MiB in total.".into(),
            AgboardError::EpicIdTaken { .. } => "Choose another EPIC-ID.".into(),
            AgboardError::EpicNotFound { .. } => "No epic has this EPIC-ID in the project.".into(),
            AgboardError::EpicInUse { .. } => "Move or clear the tasks that belong to this epic first.".into(),
            AgboardError::InvalidArgument { command, .. } => match command {
                Some(command) => format!("Run \"agboard {command} --help\" for usage."),
                None => "Run \"agboard --help\" for usage.".to_string(),
            },
            AgboardError::InvalidValue { reason, .. } => reason.clone(),
            AgboardError::InvalidStateForColumn { id, column, .. } => format!(
                "Only tasks in Doing can be running or pending. #{id} is in {}.",
                column.label()
            ),
            AgboardError::InvalidStateForAssignee => {
                "Only AI-owned tasks in Doing can be running or pending.".into()
            }
            AgboardError::TaskIsDraft { .. } => {
                "Wait for the user to finalize it, then try again.".into()
            }
            AgboardError::EpicIsDraft { .. } => {
                "Wait for the user to finalize it, then try again.".into()
            }
            AgboardError::TaskIsDone { .. } => {
                "A person must move the task out of Done before you can change it.".into()
            }
            AgboardError::OnboardingConflict { .. } => {
                "Read the guide's state again, then repeat the step with the current revision.".into()
            }
            AgboardError::OnboardingInvalid { .. } => {
                "Follow the guide's order: the step does not apply to the current state.".into()
            }
            AgboardError::AcceptanceUnmet { .. } => {
                "Mark each condition done once it is verified, or ask a person to move the task.".into()
            }
            AgboardError::TaskNotDraft { id } => {
                format!("Only a draft can be saved or finalized this way. #{id} is not a draft.")
            }
            AgboardError::InvalidStateForDraft { id, .. } => format!(
                "Only tasks whose agent status is idle can become drafts. #{id} is not idle."
            ),
            AgboardError::RequestChanged => {
                "Read the latest board before answering this request.".into()
            }
            AgboardError::TaskStatusChanged { .. } => {
                "Another change moved the task first. Check its current status and move it again."
                    .into()
            }
            AgboardError::ConfirmationRequired { .. } => {
                "Run this command yourself in a terminal. Agents cannot delete tasks or projects, or replace a board."
                    .to_string()
            }
            AgboardError::FileError { reason, .. } => reason.clone(),
            AgboardError::FileInvalid { field, reason, .. } => {
                if field.is_empty() {
                    reason.clone()
                } else {
                    format!("{field}: {reason}")
                }
            }
            AgboardError::FileUnreadable { reason, .. } => reason.clone(),
            AgboardError::FormatUnsupported {
                version, expected, ..
            } => format!(
                "Only formatVersion {expected} is supported, found {version}. The file is not converted."
            ),
            AgboardError::RequestChoiceUnknown { .. } => {
                "Choose one of the choices in the pending request.".into()
            }
            AgboardError::DatabaseBusy => "Another agboard command is writing. Try again.".to_string(),
            AgboardError::DatabaseError { reason } => reason.clone(),
            AgboardError::AlreadyServing { port } => {
                format!("Open http://127.0.0.1:{port}/ or stop the other \"agboard serve\".")
            }
            AgboardError::PortInUse { .. } => "Choose another port with --port.".to_string(),
            AgboardError::BoardUnavailable { reason } => reason.clone(),
            AgboardError::CursorInvalid { reason } => reason.clone(),
            AgboardError::WaitTimeout => {
                "Nothing changed in the project. This is not an answer; read the snapshot before acting."
                    .to_string()
            }
            AgboardError::DocsPathInvalid { reason } => reason.clone(),
            AgboardError::DocsNotFound { .. } => {
                "No such file in the project's Docs. Choose a file from the tree.".to_string()
            }
            AgboardError::DocsNotMarkdown { .. } => {
                "Only files ending in .md or .mdx can be opened.".to_string()
            }
            AgboardError::DocsTooLarge { limit, .. } => {
                format!("Files larger than {limit} bytes cannot be opened here.")
            }
            AgboardError::DocsNotUtf8 { .. } => {
                "Only UTF-8 text can be opened here. The file is not changed.".to_string()
            }
            AgboardError::DocsAssetType { .. } => {
                "Only PNG, JPEG, WebP, GIF, AVIF and SVG images are served.".to_string()
            }
            AgboardError::DocsNotImplemented => {
                "The Docs API is still being built. Try again in a later version.".to_string()
            }
            AgboardError::DocsOpenFailed { reason } => reason.clone(),
        }
    }
}
