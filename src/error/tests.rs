mod messages;

use super::*;

pub(super) fn all_errors() -> Vec<AgboardError> {
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
        AgboardError::TaskStatusChanged {
            id: 5,
            current: Column::Done,
        },
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
        AgboardError::DocsPathInvalid {
            reason: "Paths are relative and use /.".into(),
        },
        AgboardError::DocsNotFound {
            path: "a/b.md".into(),
        },
        AgboardError::DocsNotMarkdown {
            path: "a.txt".into(),
        },
        AgboardError::DocsTooLarge {
            path: "a.md".into(),
            limit: 2_097_152,
        },
        AgboardError::DocsNotUtf8 {
            path: "a.md".into(),
        },
        AgboardError::DocsAssetType {
            path: "a.svg".into(),
        },
        AgboardError::DocsNotImplemented,
        AgboardError::DocsOpenFailed {
            reason: "xdg-open is not installed".into(),
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
            ("task_status_changed", 1),
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
            ("docs_path_invalid", 1),
            ("docs_not_found", 1),
            ("docs_not_markdown", 1),
            ("docs_too_large", 1),
            ("docs_not_utf8", 1),
            ("docs_asset_type", 1),
            ("docs_not_implemented", 1),
            ("docs_open_failed", 1),
        ]
    );
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
