// file-size: allow (predates the 300-line limit; split it by responsibility rather than growing it)
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
}

impl AgboardError {
    /// Machine-readable error code (snake_case).
    pub fn code(&self) -> &'static str {
        match self {
            AgboardError::ProjectNotFound { .. } => "project_not_found",
            AgboardError::ProjectNameExists { .. } => "project_name_exists",
            AgboardError::FolderBoundElsewhere { .. } => "folder_bound_elsewhere",
            AgboardError::FolderUnbound { .. } => "folder_unbound",
            AgboardError::BoundProjectMissing { .. } => "bound_project_missing",
            AgboardError::TaskNotFound { .. } => "task_not_found",
            AgboardError::TaskArchived { .. } => "task_archived",
            AgboardError::TaskNotArchived { .. } => "task_not_archived",
            AgboardError::ArchiveTargetsChanged => "archive_targets_changed",
            AgboardError::AttachmentNotFound { .. } => "attachment_not_found",
            AgboardError::AttachmentLimitExceeded => "attachment_limit_exceeded",
            AgboardError::EpicIdTaken { .. } => "epic_id_taken",
            AgboardError::EpicNotFound { .. } => "epic_not_found",
            AgboardError::EpicInUse { .. } => "epic_in_use",
            AgboardError::InvalidArgument { .. } => "invalid_argument",
            AgboardError::InvalidValue { .. } => "invalid_value",
            AgboardError::InvalidStateForColumn { .. } => "invalid_state_for_column",
            AgboardError::InvalidStateForAssignee => "invalid_state_for_assignee",
            AgboardError::TaskIsDraft { .. } => "task_is_draft",
            AgboardError::TaskIsDone { .. } => "task_is_done",
            AgboardError::AcceptanceUnmet { .. } => "acceptance_unmet",
            AgboardError::TaskNotDraft { .. } => "task_not_draft",
            AgboardError::InvalidStateForDraft { .. } => "invalid_state_for_draft",
            AgboardError::RequestChanged => "request_changed",
            AgboardError::OnboardingConflict { .. } => "onboarding_conflict",
            AgboardError::OnboardingInvalid { .. } => "onboarding_invalid",
            AgboardError::ConfirmationRequired { .. } => "confirmation_required",
            AgboardError::FileError { .. } => "file_error",
            AgboardError::FileInvalid { .. } => "file_invalid",
            AgboardError::FileUnreadable { .. } => "file_unreadable",
            AgboardError::FormatUnsupported { .. } => "format_unsupported",
            AgboardError::RequestChoiceUnknown { .. } => "request_choice_unknown",
            AgboardError::DatabaseBusy => "database_busy",
            AgboardError::DatabaseError { .. } => "database_error",
            AgboardError::AlreadyServing { .. } => "already_serving",
            AgboardError::PortInUse { .. } => "port_in_use",
            AgboardError::BoardUnavailable { .. } => "board_unavailable",
            AgboardError::CursorInvalid { .. } => "cursor_invalid",
            AgboardError::WaitTimeout => "wait_timeout",
        }
    }

    /// Process exit code for this error.
    pub fn exit_code(&self) -> i32 {
        match self {
            AgboardError::ProjectNotFound { .. } => 4,
            AgboardError::ProjectNameExists { .. } => 2,
            AgboardError::FolderBoundElsewhere { .. } => 2,
            AgboardError::FolderUnbound { .. } | AgboardError::BoundProjectMissing { .. } => 4,
            AgboardError::TaskNotFound { .. } => 3,
            AgboardError::InvalidArgument { .. } | AgboardError::InvalidValue { .. } => 2,
            AgboardError::InvalidStateForAssignee => 2,
            AgboardError::RequestChoiceUnknown { .. } => 2,
            AgboardError::AcceptanceUnmet { .. } => 2,
            _ => 1,
        }
    }

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
        }
    }

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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_errors() -> Vec<AgboardError> {
        vec![
            AgboardError::ProjectNotFound {
                project: "Alpha".into(),
            },
            AgboardError::ProjectNameExists {
                name: "Alpha".into(),
            },
            AgboardError::TaskNotFound { id: 7 },
            AgboardError::InvalidArgument {
                message: "unexpected argument '--x'".into(),
                command: Some("add".into()),
            },
            AgboardError::InvalidValue {
                field: "title".into(),
                reason: "r".into(),
            },
            AgboardError::InvalidStateForColumn {
                id: 11,
                state: RunState::Running,
                column: Column::Todo,
            },
            AgboardError::InvalidStateForAssignee,
            AgboardError::TaskIsDraft { id: 5 },
            AgboardError::TaskIsDone { id: 5 },
            AgboardError::AcceptanceUnmet {
                id: 5,
                unmet: vec!["AC-2".into()],
            },
            AgboardError::TaskNotDraft { id: 5 },
            AgboardError::InvalidStateForDraft {
                id: 6,
                state: RunState::Running,
            },
            AgboardError::RequestChanged,
            AgboardError::ConfirmationRequired {
                operation: "deleting a task".into(),
            },
            AgboardError::FileError {
                action: FileAction::Read,
                file: "a.json".into(),
                reason: "No such file or directory (os error 2)".into(),
            },
            AgboardError::FileInvalid {
                file: "projects/p/tasks/1/task.json".into(),
                field: "title".into(),
                reason: "Titles must be 1 to 100 characters on one line.".into(),
            },
            AgboardError::FileUnreadable {
                file: "projects/p/project.json".into(),
                reason: "Permission denied (os error 13)".into(),
            },
            AgboardError::FormatUnsupported {
                file: "workspace.json".into(),
                version: "2".into(),
                expected: 1,
            },
            AgboardError::RequestChoiceUnknown {
                request_id: "a".into(),
                choice_id: "b".into(),
            },
            AgboardError::DatabaseBusy,
            AgboardError::DatabaseError {
                reason: "boom".into(),
            },
            AgboardError::AlreadyServing { port: 7420 },
            AgboardError::PortInUse { port: 7420 },
            AgboardError::BoardUnavailable {
                reason: "no running server".into(),
            },
            AgboardError::CursorInvalid {
                reason: "wrong project".into(),
            },
            AgboardError::WaitTimeout,
        ]
    }

    #[test]
    fn codes_and_exit_codes_follow_the_design_table() {
        let got: Vec<(&str, i32)> = all_errors()
            .iter()
            .map(|e| (e.code(), e.exit_code()))
            .collect();
        assert_eq!(
            got,
            vec![
                ("project_not_found", 4),
                ("project_name_exists", 2),
                ("task_not_found", 3),
                ("invalid_argument", 2),
                ("invalid_value", 2),
                ("invalid_state_for_column", 1),
                ("invalid_state_for_assignee", 2),
                ("task_is_draft", 1),
                ("task_is_done", 1),
                ("acceptance_unmet", 2),
                ("task_not_draft", 1),
                ("invalid_state_for_draft", 1),
                ("request_changed", 1),
                ("confirmation_required", 1),
                ("file_error", 1),
                ("file_invalid", 1),
                ("file_unreadable", 1),
                ("format_unsupported", 1),
                ("request_choice_unknown", 2),
                ("database_busy", 1),
                ("database_error", 1),
                ("already_serving", 1),
                ("port_in_use", 1),
                ("board_unavailable", 1),
                ("cursor_invalid", 1),
                ("wait_timeout", 1),
            ]
        );
    }

    #[test]
    fn messages_and_reasons_follow_the_design_table() {
        let got: Vec<(String, String)> = all_errors()
            .iter()
            .map(|e| (e.message(), e.reason()))
            .collect();
        let expected: Vec<(&str, &str)> = vec![
            (
                "project not found.",
                "No project matches \"Alpha\". Run \"agboard project ls\" to see the projects.",
            ),
            (
                "project \"Alpha\" already exists.",
                "Project names must be unique. Choose another name.",
            ),
            (
                "task #7 not found.",
                "No task has ID 7. Run \"agboard ls\" to see the tasks.",
            ),
            (
                "unexpected argument '--x'",
                "Run \"agboard add --help\" for usage.",
            ),
            ("title is invalid.", "r"),
            (
                "cannot set #11 to running.",
                "Only tasks in Doing can be running or pending. #11 is in Todo.",
            ),
            (
                "state is invalid for this assignee.",
                "Only AI-owned tasks in Doing can be running or pending.",
            ),
            (
                "task #5 is a draft and read-only for agents.",
                "Wait for the user to finalize it, then try again.",
            ),
            (
                "task #5 is done and read-only for agents.",
                "A person must move the task out of Done before you can change it.",
            ),
            (
                "task #5 has unmet acceptance conditions: AC-2.",
                "Mark each condition done once it is verified, or ask a person to move the task.",
            ),
            (
                "task #5 is not a draft.",
                "Only a draft can be saved or finalized this way. #5 is not a draft.",
            ),
            (
                "cannot make #6 a draft while it is running.",
                "Only tasks whose agent status is idle can become drafts. #6 is not idle.",
            ),
            (
                "the pending request has changed.",
                "Read the latest board before answering this request.",
            ),
            (
                "deleting a task needs confirmation from a human.",
                "Run this command yourself in a terminal. Agents cannot delete tasks or projects, or replace a board.",
            ),
            (
                "cannot read a.json.",
                "No such file or directory (os error 2)",
            ),
            (
                "projects/p/tasks/1/task.json is not valid.",
                "title: Titles must be 1 to 100 characters on one line.",
            ),
            (
                "cannot read projects/p/project.json.",
                "Permission denied (os error 13)",
            ),
            (
                "workspace.json has an unsupported format version.",
                "Only formatVersion 1 is supported, found 2. The file is not converted.",
            ),
            (
                "the choice is not part of this request.",
                "Choose one of the choices in the pending request.",
            ),
            (
                "the board is busy.",
                "Another agboard command is writing. Try again.",
            ),
            ("cannot open the board.", "boom"),
            (
                "the board is already being served.",
                "Open http://127.0.0.1:7420/ or stop the other \"agboard serve\".",
            ),
            (
                "port 7420 is already in use.",
                "Choose another port with --port.",
            ),
            ("the board is unavailable.", "no running server"),
            ("the cursor is invalid.", "wrong project"),
            (
                "no board change before the timeout.",
                "Nothing changed in the project. This is not an answer; read the snapshot before acting.",
            ),
        ];
        let expected: Vec<(String, String)> = expected
            .into_iter()
            .map(|(m, r)| (m.to_string(), r.to_string()))
            .collect();
        assert_eq!(got, expected);
    }

    #[test]
    fn invalid_argument_without_command_points_to_top_level_help() {
        let e = AgboardError::InvalidArgument {
            message: "bad".into(),
            command: None,
        };
        assert_eq!(e.reason(), "Run \"agboard --help\" for usage.");
    }

    #[test]
    fn write_file_error_says_cannot_write() {
        let e = AgboardError::FileError {
            action: FileAction::Write,
            file: "out.json".into(),
            reason: "denied".into(),
        };
        assert_eq!(e.message(), "cannot write out.json.");
    }

    #[test]
    fn display_is_the_message() {
        assert_eq!(AgboardError::DatabaseBusy.to_string(), "the board is busy.");
    }
}
