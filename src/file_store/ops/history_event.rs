//! The history record written for a lane, agent, draft, epic or archive change.

use chrono::{DateTime, Utc};

use crate::domain::{Column, RunState};
use crate::error::AgboardError;
use crate::file_store::model::HistoryRecord;

/// Context used to generate an informative default reason.
#[derive(Debug, Clone, Copy)]
pub(super) enum HistoryKind {
    Created,
    Lane,
    Agent,
    Draft,
    Epic,
    Archive,
    Restore,
}

pub(super) struct Transition<'a> {
    pub kind: HistoryKind,
    pub language: crate::file_store::history_language::HistoryLanguage,
    pub reason: Option<&'a str>,
    pub from_task: Option<Column>,
    pub to_task: Column,
    pub from_agent: Option<RunState>,
    pub to_agent: RunState,
    pub at: DateTime<Utc>,
}

pub(super) fn transition_event(t: Transition<'_>) -> Result<HistoryRecord, AgboardError> {
    let fallback = match t.kind {
        HistoryKind::Created => format!(
            "Created task in {} with agent {}.",
            t.to_task.label(),
            t.to_agent.as_str()
        ),
        HistoryKind::Lane => format!(
            "Moved task from {} to {}; agent is {}.",
            t.from_task.unwrap_or(t.to_task).label(),
            t.to_task.label(),
            t.to_agent.as_str()
        ),
        HistoryKind::Agent => format!(
            "Changed agent from {} to {} in {}.",
            t.from_agent.unwrap_or(t.to_agent).as_str(),
            t.to_agent.as_str(),
            t.to_task.label()
        ),
        HistoryKind::Draft => "Changed task draft status.".into(),
        HistoryKind::Epic => "Changed task epic.".into(),
        HistoryKind::Archive => format!("Archived task in {}; agent is idle.", t.to_task.label()),
        HistoryKind::Restore => format!("Restored task in {}.", t.to_task.label()),
    };
    let japanese = match t.kind {
        HistoryKind::Created => format!(
            "タスクを{}に作成しました。エージェントは{}です。",
            t.to_task.label(),
            t.to_agent.as_str()
        ),
        HistoryKind::Lane => format!(
            "タスクを{}から{}に移動しました。エージェントは{}です。",
            t.from_task.unwrap_or(t.to_task).label(),
            t.to_task.label(),
            t.to_agent.as_str()
        ),
        HistoryKind::Agent => format!(
            "{}でエージェントを{}から{}に変更しました。",
            t.to_task.label(),
            t.from_agent.unwrap_or(t.to_agent).as_str(),
            t.to_agent.as_str()
        ),
        HistoryKind::Draft => "タスクの下書き状態を変更しました。".into(),
        HistoryKind::Epic => "所属エピックを変更しました。".into(),
        HistoryKind::Archive => format!(
            "{}のタスクをアーカイブしました。エージェントはidleです。",
            t.to_task.label()
        ),
        HistoryKind::Restore => format!("タスクを{}に復元しました。", t.to_task.label()),
    };
    let reason = reason_or_default(t.reason, t.language.text(&fallback, &japanese).to_owned())?;

    Ok(HistoryRecord { at: t.at, reason })
}

pub(super) fn reason_or_default(
    reason: Option<&str>,
    fallback: String,
) -> Result<String, AgboardError> {
    let reason = reason
        .filter(|reason| !reason.trim().is_empty())
        .unwrap_or(&fallback);
    crate::domain::validate_work_reason(reason)?;
    Ok(reason.to_owned())
}
