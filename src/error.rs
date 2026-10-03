use thiserror::Error;

use crate::domain::{Column, RunState};

/// Whether a file operation was a read or a write (for `file_error`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileAction {
    Read,
    Write,
}

/// Every error `skan` can report. Each variant maps to one error code in the
/// design's error table, plus `NotImplemented` for temporary stubs.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{}", self.message())]
pub enum SkanError {
    NotInitialized,
    CardNotFound {
        id: i64,
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
    ReasonRequiresPending,
    InvalidStateForColumn {
        id: i64,
        state: RunState,
        column: Column,
    },
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
    NotImplemented {
        command: String,
    },
}

impl SkanError {
    /// Machine-readable error code (snake_case).
    pub fn code(&self) -> &'static str {
        match self {
            SkanError::NotInitialized => "not_initialized",
            SkanError::CardNotFound { .. } => "card_not_found",
            SkanError::InvalidArgument { .. } => "invalid_argument",
            SkanError::InvalidValue { .. } => "invalid_value",
            SkanError::ReasonRequiresPending => "reason_requires_pending",
            SkanError::InvalidStateForColumn { .. } => "invalid_state_for_column",
            SkanError::ConfirmationRequired { .. } => "confirmation_required",
            SkanError::ImportInvalid { .. } => "import_invalid",
            SkanError::FileError { .. } => "file_error",
            SkanError::DatabaseBusy => "database_busy",
            SkanError::DatabaseError { .. } => "database_error",
            SkanError::AlreadyServing { .. } => "already_serving",
            SkanError::PortInUse { .. } => "port_in_use",
            SkanError::NotImplemented { .. } => "not_implemented",
        }
    }

    /// Process exit code for this error.
    pub fn exit_code(&self) -> i32 {
        match self {
            SkanError::NotInitialized => 4,
            SkanError::CardNotFound { .. } => 3,
            SkanError::InvalidArgument { .. }
            | SkanError::InvalidValue { .. }
            | SkanError::ReasonRequiresPending => 2,
            _ => 1,
        }
    }

    /// One-line summary of what went wrong.
    pub fn message(&self) -> String {
        match self {
            SkanError::NotInitialized => "no board found.".to_string(),
            SkanError::CardNotFound { id } => format!("card #{id} not found."),
            SkanError::InvalidArgument { message, .. } => message.clone(),
            SkanError::InvalidValue { field, .. } => format!("{field} is invalid."),
            SkanError::ReasonRequiresPending => {
                "--reason can only be used with pending.".to_string()
            }
            SkanError::InvalidStateForColumn { id, state, .. } => {
                format!("cannot set #{id} to {}.", state.as_str())
            }
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
            SkanError::NotImplemented { command } => format!("{command} is not implemented yet."),
        }
    }

    /// What to do about it, or why it happened.
    pub fn reason(&self) -> String {
        match self {
            SkanError::NotInitialized => {
                "Run \"skan init --name <name>\" to create one, or \"skan import\" to restore one."
                    .to_string()
            }
            SkanError::CardNotFound { id } => {
                format!("No card has ID {id}. Run \"skan ls\" to see the cards.")
            }
            SkanError::InvalidArgument { command, .. } => match command {
                Some(command) => format!("Run \"skan {command} --help\" for usage."),
                None => "Run \"skan --help\" for usage.".to_string(),
            },
            SkanError::InvalidValue { reason, .. } => reason.clone(),
            SkanError::ReasonRequiresPending => {
                "A reason explains what a pending card is waiting for.".to_string()
            }
            SkanError::InvalidStateForColumn { id, column, .. } => format!(
                "Only cards in Doing can be running or pending. #{id} is in {}.",
                column.label()
            ),
            SkanError::ConfirmationRequired { .. } => {
                "Run this command yourself in a terminal. Agents cannot delete cards or replace the board."
                    .to_string()
            }
            SkanError::ImportInvalid { reason, .. } => reason.clone(),
            SkanError::FileError { reason, .. } => reason.clone(),
            SkanError::DatabaseBusy => "Another skan command is writing. Try again.".to_string(),
            SkanError::DatabaseError { reason } => reason.clone(),
            SkanError::AlreadyServing { port } => {
                format!("Open http://127.0.0.1:{port}/ or stop the other \"skan serve\".")
            }
            SkanError::PortInUse { .. } => "Choose another port with --port.".to_string(),
            SkanError::NotImplemented { .. } => "This build is incomplete.".to_string(),
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
            SkanError::CardNotFound { id: 7 },
            SkanError::InvalidArgument {
                message: "unexpected argument '--x'".into(),
                command: Some("add".into()),
            },
            SkanError::InvalidValue {
                field: "title".into(),
                reason: "r".into(),
            },
            SkanError::ReasonRequiresPending,
            SkanError::InvalidStateForColumn {
                id: 11,
                state: RunState::Running,
                column: Column::Todo,
            },
            SkanError::ConfirmationRequired {
                operation: "deleting a card".into(),
            },
            SkanError::ImportInvalid {
                file: "skan.json".into(),
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
            SkanError::NotImplemented {
                command: "rm".into(),
            },
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
                ("card_not_found", 3),
                ("invalid_argument", 2),
                ("invalid_value", 2),
                ("reason_requires_pending", 2),
                ("invalid_state_for_column", 1),
                ("confirmation_required", 1),
                ("import_invalid", 1),
                ("file_error", 1),
                ("database_busy", 1),
                ("database_error", 1),
                ("already_serving", 1),
                ("port_in_use", 1),
                ("not_implemented", 1),
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
                "Run \"skan init --name <name>\" to create one, or \"skan import\" to restore one.",
            ),
            (
                "card #7 not found.",
                "No card has ID 7. Run \"skan ls\" to see the cards.",
            ),
            (
                "unexpected argument '--x'",
                "Run \"skan add --help\" for usage.",
            ),
            ("title is invalid.", "r"),
            (
                "--reason can only be used with pending.",
                "A reason explains what a pending card is waiting for.",
            ),
            (
                "cannot set #11 to running.",
                "Only cards in Doing can be running or pending. #11 is in Todo.",
            ),
            (
                "deleting a card needs confirmation from a human.",
                "Run this command yourself in a terminal. Agents cannot delete cards or replace the board.",
            ),
            (
                "skan.json is not a valid board file.",
                "Card #12 is pending but is in Todo.",
            ),
            (
                "cannot read a.json.",
                "No such file or directory (os error 2)",
            ),
            (
                "the board is busy.",
                "Another skan command is writing. Try again.",
            ),
            ("cannot open the board.", "boom"),
            (
                "the board is already being served.",
                "Open http://127.0.0.1:7420/ or stop the other \"skan serve\".",
            ),
            (
                "port 7420 is already in use.",
                "Choose another port with --port.",
            ),
            ("rm is not implemented yet.", "This build is incomplete."),
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
        assert_eq!(e.reason(), "Run \"skan --help\" for usage.");
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
