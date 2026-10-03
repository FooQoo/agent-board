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
    pub fn code(&self) -> &'static str {
        todo!()
    }

    pub fn exit_code(&self) -> i32 {
        todo!()
    }

    pub fn message(&self) -> String {
        todo!()
    }

    pub fn reason(&self) -> String {
        todo!()
    }
}
