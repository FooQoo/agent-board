//! Small renderers shared by CLI commands.
use crate::domain::{Column, RunState};
use crate::file_store::model::TaskView;
use serde_json::Value;

/// The order of keys in JSON output. Keys not listed come last.
///
/// One list serves every object, so a key keeps one position: a project is
/// `id, name, createdAt`, a board `name, nextTaskId, createdAt`, and the
/// snapshot root `fetchedAt, project, version, cursor, nextTaskId, tasks, problems`.
const KEY_ORDER: [&str; 35] = [
    "error",
    "code",
    "message",
    "reason",
    "fetchedAt",
    "project",
    "projects",
    "catalogVersion",
    "version",
    "cursor",
    "board",
    "task",
    "taskId",
    "tasks",
    "attachment",
    "attachments",
    "path",
    "url",
    "id",
    "name",
    "nextTaskId",
    "title",
    "description",
    "assignee",
    "taskStatus",
    "position",
    "agentStatus",
    "pendingReason",
    "pendingRequestId",
    "isDraft",
    "createdAt",
    "updatedAt",
    "agentStatusChangedAt",
    "history",
    "problems",
];

/// The order of keys in one history event, which reuses the key `reason`.
const EVENT_KEY_ORDER: [&str; 2] = ["at", "reason"];
pub fn render_json(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let order: &[&str] =
                if map.len() == 2 && map.contains_key("at") && map.contains_key("reason") {
                    &EVENT_KEY_ORDER
                } else {
                    &KEY_ORDER
                };
            let mut entries: Vec<_> = map.iter().collect();
            entries.sort_by_key(|(key, _)| {
                order
                    .iter()
                    .position(|item| item == key)
                    .unwrap_or(order.len())
            });
            format!(
                "{{{}}}",
                entries
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap(),
                        render_json(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(render_json).collect::<Vec<_>>().join(",")
        ),
        _ => value.to_string(),
    }
}

pub fn task_value(task: &TaskView) -> Value {
    serde_json::to_value(task).expect("Agent Board tasks serialize")
}

pub fn state_text(state: RunState, reason: Option<&str>) -> String {
    match (state, reason) {
        (RunState::Pending, Some(reason)) => format!("pending: {reason}"),
        _ => state.as_str().to_string(),
    }
}

pub fn ls_text(tasks: &[TaskView], columns: &[Column]) -> String {
    let mut out = String::new();
    for column in columns {
        out.push_str(&format!("{}\n", column.label()));
        for task in tasks.iter().filter(|task| task.task_status == *column) {
            out.push_str(&format!("  #{} {}", task.id, task.title));
            out.push_str(match task.assignee {
                crate::domain::Assignee::Ai => " [AI]",
                crate::domain::Assignee::Human => " [User]",
            });
            if task.is_draft {
                out.push_str(" [draft]");
            }
            if let Some(epic) = &task.epic_id {
                out.push_str(&format!(" [{epic}]"));
            }
            if task.assignee == crate::domain::Assignee::Ai && column == &Column::Doing {
                out.push_str(&format!(
                    " [{}]",
                    state_text(task.agent_status, task.pending_reason.as_deref())
                ));
            }
            out.push('\n');
        }
    }
    out
}

pub fn show_text(task: &TaskView) -> String {
    let mut out = format!(
        "#{} {}\nTask status: {}\nAssignee: {}\n",
        task.id,
        task.title,
        task.task_status.label(),
        match task.assignee {
            crate::domain::Assignee::Ai => "AI",
            crate::domain::Assignee::Human => "User",
        }
    );
    if task.assignee == crate::domain::Assignee::Ai && task.task_status == Column::Doing {
        out.push_str(&format!(
            "Agent status: {}\n",
            state_text(task.agent_status, task.pending_reason.as_deref())
        ));
    }
    if let Some(epic) = &task.epic_id {
        out.push_str(&format!("Epic: {epic}\n"));
    }
    if task.is_draft {
        out.push_str("Draft: yes\n");
    }
    if let Some(archived_at) = task.archived_at {
        out.push_str(&format!("Archived at: {}\n", archived_at.to_rfc3339()));
    }
    if !task.description.is_empty() {
        out.push_str(&format!("Description:\n{}\n", task.description));
    }
    out.push_str("History:\n");
    for event in task.history.iter().rev() {
        out.push_str(&format!(
            "  {}: {}\n",
            crate::clock::format_utc(event.at),
            event.reason
        ));
    }
    out
}
