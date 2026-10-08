use thiserror::Error;

use crate::domain::{Column, RunState};

/// Whether a file operation was a read or a write (for `file_error`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileAction {
    Read,
    Write,
}

/// Every error `skan` can report. Each variant maps to one error code in the
/// design's error table.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{}", self.message())]
pub enum SkanError {
    NotInitialized,
    /// `project` is the name or ID the caller used to look the project up.
    ProjectNotFound {
        project: String,
    },
    ProjectNameExists {
        name: String,
    },
    CardNotFound {
        id: i64,
    },
    AttachmentNotFound {
        id: String,
    },
    AttachmentRequestConflict,
    AttachmentLimitExceeded,
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
    /// The card is a draft: agents and the CLI cannot change it.
    CardIsDraft {
        id: i64,
    },
    /// A draft operation was applied to a card that is not a draft.
    CardNotDraft {
        id: i64,
    },
    /// Only cards whose agent status is idle can become drafts.
    InvalidStateForDraft {
        id: i64,
        state: RunState,
    },
    RequestChanged,
    ConfirmationRequired {
        operation: String,
    },
    ImportInvalid {
        file: String,
        reason: String,
    },
    FileError {
        action: FileAction,
        file: String,
        reason: String,
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

impl SkanError {
    /// Machine-readable error code (snake_case).
    pub fn code(&self) -> &'static str {
        match self {
            SkanError::NotInitialized => "not_initialized",
            SkanError::ProjectNotFound { .. } => "project_not_found",
            SkanError::ProjectNameExists { .. } => "project_name_exists",
            SkanError::CardNotFound { .. } => "card_not_found",
            SkanError::AttachmentNotFound { .. } => "attachment_not_found",
            SkanError::AttachmentRequestConflict => "attachment_request_conflict",
            SkanError::AttachmentLimitExceeded => "attachment_limit_exceeded",
            SkanError::InvalidArgument { .. } => "invalid_argument",
            SkanError::InvalidValue { .. } => "invalid_value",
            SkanError::InvalidStateForColumn { .. } => "invalid_state_for_column",
            SkanError::InvalidStateForAssignee => "invalid_state_for_assignee",
            SkanError::CardIsDraft { .. } => "card_is_draft",
            SkanError::CardNotDraft { .. } => "card_not_draft",
            SkanError::InvalidStateForDraft { .. } => "invalid_state_for_draft",
            SkanError::RequestChanged => "request_changed",
            SkanError::ConfirmationRequired { .. } => "confirmation_required",
            SkanError::ImportInvalid { .. } => "import_invalid",
            SkanError::FileError { .. } => "file_error",
            SkanError::DatabaseBusy => "database_busy",
            SkanError::DatabaseError { .. } => "database_error",
            SkanError::AlreadyServing { .. } => "already_serving",
            SkanError::PortInUse { .. } => "port_in_use",
            SkanError::BoardUnavailable { .. } => "board_unavailable",
            SkanError::CursorInvalid { .. } => "cursor_invalid",
            SkanError::WaitTimeout => "wait_timeout",
        }
    }

    /// Process exit code for this error.
    pub fn exit_code(&self) -> i32 {
        match self {
            SkanError::NotInitialized | SkanError::ProjectNotFound { .. } => 4,
            SkanError::ProjectNameExists { .. } => 2,
            SkanError::CardNotFound { .. } => 3,
            SkanError::InvalidArgument { .. } | SkanError::InvalidValue { .. } => 2,
            SkanError::InvalidStateForAssignee => 2,
            _ => 1,
        }
    }

    /// One-line summary of what went wrong.
    pub fn message(&self) -> String {
        match self {
            SkanError::NotInitialized => "no board found.".to_string(),
            SkanError::ProjectNotFound { .. } => "project not found.".to_string(),
            SkanError::ProjectNameExists { name } => format!("project \"{name}\" already exists."),
            SkanError::CardNotFound { id } => format!("card #{id} not found."),
            SkanError::AttachmentNotFound { id } => format!("attachment {id} not found."),
            SkanError::AttachmentRequestConflict => {
                "attachment request was reused with different content.".into()
            }
            SkanError::AttachmentLimitExceeded => "attachment limits were exceeded.".into(),
            SkanError::InvalidArgument { message, .. } => message.clone(),
            SkanError::InvalidValue { field, .. } => format!("{field} is invalid."),
            SkanError::InvalidStateForColumn { id, state, .. } => {
                format!("cannot set #{id} to {}.", state.as_str())
            }
            SkanError::InvalidStateForAssignee => "state is invalid for this assignee.".into(),
            SkanError::CardIsDraft { id } => {
                format!("card #{id} is a draft and read-only for agents.")
            }
            SkanError::CardNotDraft { id } => format!("card #{id} is not a draft."),
            SkanError::InvalidStateForDraft { id, state } => {
                format!("cannot make #{id} a draft while it is {}.", state.as_str())
            }
            SkanError::RequestChanged => "the pending request has changed.".into(),
            SkanError::ConfirmationRequired { operation } => {
                format!("{operation} needs confirmation from a human.")
            }
            SkanError::ImportInvalid { file, .. } => format!("{file} is not a valid board file."),
            SkanError::FileError { action, file, .. } => match action {
                FileAction::Read => format!("cannot read {file}."),
                FileAction::Write => format!("cannot write {file}."),
            },
            SkanError::DatabaseBusy => "the board is busy.".to_string(),
            SkanError::DatabaseError { .. } => "cannot open the board.".to_string(),
            SkanError::AlreadyServing { .. } => "the board is already being served.".to_string(),
            SkanError::PortInUse { port } => format!("port {port} is already in use."),
            SkanError::BoardUnavailable { .. } => "the board is unavailable.".to_string(),
            SkanError::CursorInvalid { .. } => "the cursor is invalid.".to_string(),
            SkanError::WaitTimeout => "no board change before the timeout.".to_string(),
        }
    }

    /// What to do about it, or why it happened.
    pub fn reason(&self) -> String {
        match self {
            SkanError::NotInitialized => {
                "Run \"agboard --project <name> init\" to create one, or \"agboard --project <name> import\" to restore one."
                    .to_string()
            }
            SkanError::ProjectNotFound { project } => format!(
                "No project matches \"{project}\". Run \"agboard project ls\" to see the projects."
            ),
            SkanError::ProjectNameExists { .. } => {
                "Project names must be unique. Choose another name.".to_string()
            }
            SkanError::CardNotFound { id } => {
                format!("No card has ID {id}. Run \"agboard ls\" to see the cards.")
            }
            SkanError::AttachmentNotFound { .. } => "The attachment does not belong to this card.".into(),
            SkanError::AttachmentRequestConflict => "Use a new request ID when the content changes.".into(),
            SkanError::AttachmentLimitExceeded => "A card may contain at most 20 images and 50 MiB in total.".into(),
            SkanError::InvalidArgument { command, .. } => match command {
                Some(command) => format!("Run \"agboard {command} --help\" for usage."),
                None => "Run \"agboard --help\" for usage.".to_string(),
            },
            SkanError::InvalidValue { reason, .. } => reason.clone(),
            SkanError::InvalidStateForColumn { id, column, .. } => format!(
                "Only cards in Doing can be running or pending. #{id} is in {}.",
                column.label()
            ),
            SkanError::InvalidStateForAssignee => {
                "Only AI-owned cards in Doing can be running or pending.".into()
            }
            SkanError::CardIsDraft { .. } => {
                "Wait for the user to finalize it, then try again.".into()
            }
            SkanError::CardNotDraft { id } => {
                format!("Only a draft can be saved or finalized this way. #{id} is not a draft.")
            }
            SkanError::InvalidStateForDraft { id, .. } => format!(
                "Only cards whose agent status is idle can become drafts. #{id} is not idle."
            ),
            SkanError::RequestChanged => {
                "Read the latest board before answering this request.".into()
            }
            SkanError::ConfirmationRequired { .. } => {
                "Run this command yourself in a terminal. Agents cannot delete cards or projects, or replace a board."
                    .to_string()
            }
            SkanError::ImportInvalid { reason, .. } => reason.clone(),
            SkanError::FileError { reason, .. } => reason.clone(),
            SkanError::DatabaseBusy => "Another agboard command is writing. Try again.".to_string(),
            SkanError::DatabaseError { reason } => reason.clone(),
            SkanError::AlreadyServing { port } => {
                format!("Open http://127.0.0.1:{port}/ or stop the other \"agboard serve\".")
            }
            SkanError::PortInUse { .. } => "Choose another port with --port.".to_string(),
            SkanError::BoardUnavailable { reason } => reason.clone(),
            SkanError::CursorInvalid { reason } => reason.clone(),
            SkanError::WaitTimeout => {
                "Nothing changed in the project. This is not an answer; read the snapshot before acting."
                    .to_string()
            }
        }
    }
}

impl From<rusqlite::Error> for SkanError {
    /// `SQLITE_BUSY` and `SQLITE_LOCKED` become `DatabaseBusy`; anything else
    /// is a `DatabaseError` carrying the SQLite message.
    fn from(error: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(failure, _) = &error
            && matches!(
                failure.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            )
        {
            return SkanError::DatabaseBusy;
        }
        SkanError::DatabaseError {
            reason: error.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_errors() -> Vec<SkanError> {
        vec![
            SkanError::NotInitialized,
            SkanError::ProjectNotFound {
                project: "Alpha".into(),
            },
            SkanError::ProjectNameExists {
                name: "Alpha".into(),
            },
            SkanError::CardNotFound { id: 7 },
            SkanError::InvalidArgument {
                message: "unexpected argument '--x'".into(),
                command: Some("add".into()),
            },
            SkanError::InvalidValue {
                field: "title".into(),
                reason: "r".into(),
            },
            SkanError::InvalidStateForColumn {
                id: 11,
                state: RunState::Running,
                column: Column::Todo,
            },
            SkanError::InvalidStateForAssignee,
            SkanError::CardIsDraft { id: 5 },
            SkanError::CardNotDraft { id: 5 },
            SkanError::InvalidStateForDraft {
                id: 6,
                state: RunState::Running,
            },
            SkanError::RequestChanged,
            SkanError::ConfirmationRequired {
                operation: "deleting a card".into(),
            },
            SkanError::ImportInvalid {
                file: "agboard.json".into(),
                reason: "Card #12 is pending but is in Todo.".into(),
            },
            SkanError::FileError {
                action: FileAction::Read,
                file: "a.json".into(),
                reason: "No such file or directory (os error 2)".into(),
            },
            SkanError::DatabaseBusy,
            SkanError::DatabaseError {
                reason: "boom".into(),
            },
            SkanError::AlreadyServing { port: 7420 },
            SkanError::PortInUse { port: 7420 },
            SkanError::BoardUnavailable {
                reason: "no running server".into(),
            },
            SkanError::CursorInvalid {
                reason: "wrong project".into(),
            },
            SkanError::WaitTimeout,
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
                ("not_initialized", 4),
                ("project_not_found", 4),
                ("project_name_exists", 2),
                ("card_not_found", 3),
                ("invalid_argument", 2),
                ("invalid_value", 2),
                ("invalid_state_for_column", 1),
                ("invalid_state_for_assignee", 2),
                ("card_is_draft", 1),
                ("card_not_draft", 1),
                ("invalid_state_for_draft", 1),
                ("request_changed", 1),
                ("confirmation_required", 1),
                ("import_invalid", 1),
                ("file_error", 1),
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
                "no board found.",
                "Run \"agboard --project <name> init\" to create one, or \"agboard --project <name> import\" to restore one.",
            ),
            (
                "project not found.",
                "No project matches \"Alpha\". Run \"agboard project ls\" to see the projects.",
            ),
            (
                "project \"Alpha\" already exists.",
                "Project names must be unique. Choose another name.",
            ),
            (
                "card #7 not found.",
                "No card has ID 7. Run \"agboard ls\" to see the cards.",
            ),
            (
                "unexpected argument '--x'",
                "Run \"agboard add --help\" for usage.",
            ),
            ("title is invalid.", "r"),
            (
                "cannot set #11 to running.",
                "Only cards in Doing can be running or pending. #11 is in Todo.",
            ),
            (
                "state is invalid for this assignee.",
                "Only AI-owned cards in Doing can be running or pending.",
            ),
            (
                "card #5 is a draft and read-only for agents.",
                "Wait for the user to finalize it, then try again.",
            ),
            (
                "card #5 is not a draft.",
                "Only a draft can be saved or finalized this way. #5 is not a draft.",
            ),
            (
                "cannot make #6 a draft while it is running.",
                "Only cards whose agent status is idle can become drafts. #6 is not idle.",
            ),
            (
                "the pending request has changed.",
                "Read the latest board before answering this request.",
            ),
            (
                "deleting a card needs confirmation from a human.",
                "Run this command yourself in a terminal. Agents cannot delete cards or projects, or replace a board.",
            ),
            (
                "agboard.json is not a valid board file.",
                "Card #12 is pending but is in Todo.",
            ),
            (
                "cannot read a.json.",
                "No such file or directory (os error 2)",
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
        let e = SkanError::InvalidArgument {
            message: "bad".into(),
            command: None,
        };
        assert_eq!(e.reason(), "Run \"agboard --help\" for usage.");
    }

    #[test]
    fn write_file_error_says_cannot_write() {
        let e = SkanError::FileError {
            action: FileAction::Write,
            file: "out.json".into(),
            reason: "denied".into(),
        };
        assert_eq!(e.message(), "cannot write out.json.");
    }

    #[test]
    fn display_is_the_message() {
        assert_eq!(SkanError::DatabaseBusy.to_string(), "the board is busy.");
    }

    #[test]
    fn sqlite_busy_maps_to_database_busy_and_others_to_database_error() {
        let busy = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            None,
        );
        assert_eq!(SkanError::from(busy), SkanError::DatabaseBusy);
        let locked = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_LOCKED),
            None,
        );
        assert_eq!(SkanError::from(locked), SkanError::DatabaseBusy);
        let other = SkanError::from(rusqlite::Error::QueryReturnedNoRows);
        assert!(matches!(other, SkanError::DatabaseError { .. }));
    }
}
