use super::AgboardError;

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
            AgboardError::TaskStatusChanged { .. } => "task_status_changed",
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
            AgboardError::DocsPathInvalid { .. } => "docs_path_invalid",
            AgboardError::DocsNotFound { .. } => "docs_not_found",
            AgboardError::DocsNotMarkdown { .. } => "docs_not_markdown",
            AgboardError::DocsTooLarge { .. } => "docs_too_large",
            AgboardError::DocsNotUtf8 { .. } => "docs_not_utf8",
            AgboardError::DocsAssetType { .. } => "docs_asset_type",
            AgboardError::DocsNotImplemented => "docs_not_implemented",
            AgboardError::DocsOpenFailed { .. } => "docs_open_failed",
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
}
