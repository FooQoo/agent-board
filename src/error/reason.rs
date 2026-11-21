use super::{AgboardError, PortHolder};

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
            AgboardError::TaskInBacklog { .. } => {
                "Send it to Todo first (agboard send), then try again.".into()
            }
            AgboardError::EpicIsDraft { .. } => {
                "Wait for the user to finalize it, then try again.".into()
            }
            AgboardError::SendWithOpenQuestions { .. } => {
                "Check the questions, then send again with --force (the API takes ack: true)."
                    .into()
            }
            AgboardError::HumanOnly { .. } => {
                "Ask the user to do this in the web UI or run it with --actor human.".into()
            }
            AgboardError::AiOnly { .. } => {
                "An agent does this with --actor ai; a person has no way to do it.".into()
            }
            AgboardError::TaskIsDone { .. } => {
                "A person must move the task out of Done before you can change it.".into()
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
            AgboardError::QuestionsUnanswered { .. } => {
                "Wait for the answers with \"agboard message wait\", or see the questions with \"agboard message ls --task ID\".".into()
            }
            AgboardError::QuestionAnswered { .. } => {
                "The first recorded answer is kept. Compare it with the answer you have, and ask again if they differ.".into()
            }
            AgboardError::QuestionWithdrawn { .. } => {
                "A withdrawn question takes no answer. Ask a new question if one is still needed.".into()
            }
            AgboardError::StartBlockedByQuestions { .. } => {
                "Answer the questions (the board, or \"agboard message answer\"), then send again.".into()
            }
            AgboardError::MessageNotFound { .. } => {
                "Run \"agboard message ls --status all\" to see the messages of the project.".into()
            }
            AgboardError::MessageClosed { .. } => {
                "The message already has its reply; there is nothing to withdraw.".into()
            }
            AgboardError::MessageTypeMismatch { expected, .. } => {
                format!("Name a {expected} for this command.")
            }
            AgboardError::RequestAccepted { .. } => {
                "Another agent accepted this request first. Leave it to that agent.".into()
            }
            AgboardError::AnswerAccepted { .. } => {
                "An agent took this answer in before. Read it with \"agboard message show ID\".".into()
            }
            AgboardError::QuestionOpen { .. } => {
                "Only an answered question can be accepted. Wait for the answer with \"agboard message wait\"."
                    .into()
            }
            AgboardError::RequestWithdrawn { .. } => {
                "The person withdrew this request. Nothing is written to a withdrawn request.".into()
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
            AgboardError::ChoiceUnknown { .. } => {
                "Choose one of the choices of the question.".into()
            }
            AgboardError::DatabaseBusy => "Another agboard command is writing. Try again.".to_string(),
            AgboardError::DatabaseError { reason } => reason.clone(),
            AgboardError::AlreadyServing { port, auto: false } => {
                format!("Open http://127.0.0.1:{port}/ or stop the other \"agboard serve\".")
            }
            AgboardError::AlreadyServing { port, auto: true } => format!(
                "A server started automatically is running at http://127.0.0.1:{port}/. Run \"agboard serve -d\" to keep it running, or stop it with \"agboard stop\"."
            ),
            AgboardError::PortInUse { port, holder } => port_in_use_reason(*port, *holder),
            AgboardError::LocalNetworkDenied => LOCAL_NETWORK_DENIED.to_string(),
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
            AgboardError::RemoteUnavailable { reason } => reason.clone(),
            AgboardError::InvalidDomain => "Give a host name only, such as example.ngrok-free.dev, without https://, a path, or a port.".to_string(),
            AgboardError::KeychainUnavailable { reason } => reason.clone(),
            AgboardError::BrowserOpenFailed { url, reason } => {
                format!("{reason} Open {url} in your browser yourself.")
            }
            AgboardError::AgentCliMissing { tool } => format!(
                "Install {tool} and make it available on the PATH of the server, then try again."
            ),
            AgboardError::AgentCliLoggedOut { tool } => {
                format!("Log in to {tool} in a terminal, then try again.")
            }
            AgboardError::SessionLaunchRefused { reason } => reason.clone(),
            AgboardError::SessionLaunchFailed { reason } => reason.clone(),
            AgboardError::ProjectHasNoFolder { project } => format!(
                "Bind a folder to project {project} with \"agboard project bind\" in that folder."
            ),
        }
    }
}

/// Why `agboard` cannot listen on or reach 127.0.0.1, and the fix for Codex.
const LOCAL_NETWORK_DENIED: &str = "This environment does not allow local network connections, so the Agent Board server cannot be started or reached. In Codex, run \"agboard setup\" to allow agboard to run outside the sandbox.";

fn port_in_use_reason(port: u16, holder: PortHolder) -> String {
    match holder {
        PortHolder::AgentBoard { pid } => format!(
            "Port {port} is used by another Agent Board server (pid {pid}) with a different data folder. Choose another port with --port."
        ),
        PortHolder::OtherProgram => {
            format!("Port {port} is used by another program. Choose another port with --port.")
        }
        PortHolder::Unknown => "Choose another port with --port.".to_string(),
    }
}
