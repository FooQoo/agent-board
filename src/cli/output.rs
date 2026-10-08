//! Small renderers shared by CLI commands.
use crate::domain::{Card, Column, RunState};
use serde_json::Value;

/// The order of keys in JSON output. Keys not listed come last.
///
/// One list serves every object, so a key keeps one position: a project is
/// `id, name, createdAt`, a board `name, nextCardId, createdAt`, and the
/// snapshot root `fetchedAt, project, revision, cursor, board, cards`.
const KEY_ORDER: [&str; 34] = [
    "error",
    "code",
    "message",
    "reason",
    "fetchedAt",
    "project",
    "projects",
    "catalogRevision",
    "revision",
    "cursor",
    "board",
    "card",
    "cardId",
    "cards",
    "attachment",
    "attachments",
    "path",
    "url",
    "id",
    "name",
    "nextCardId",
    "title",
    "description",
    "assignee",
    "cardStatus",
    "position",
    "agentStatus",
    "pendingReason",
    "pendingRequestId",
    "isDraft",
    "createdAt",
    "updatedAt",
    "agentStatusChangedAt",
    "history",
];

/// The order of keys in one history event, which reuses the key `reason`.
const EVENT_KEY_ORDER: [&str; 10] = [
    "id",
    "kind",
    "actor",
    "reason",
    "fromCardStatus",
    "toCardStatus",
    "fromAgentStatus",
    "toAgentStatus",
    "requestId",
    "at",
];

pub fn render_json(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let order: &[&str] = if map.contains_key("kind") && map.contains_key("toCardStatus") {
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

pub fn card_value(card: &Card) -> Value {
    serde_json::to_value(card).expect("Agent Board cards serialize")
}

pub fn state_text(state: RunState, reason: Option<&str>) -> String {
    match (state, reason) {
        (RunState::Pending, Some(reason)) => format!("pending: {reason}"),
        _ => state.as_str().to_string(),
    }
}

pub fn ls_text(cards: &[Card], columns: &[Column]) -> String {
    let mut out = String::new();
    for column in columns {
        out.push_str(&format!("{}\n", column.label()));
        for card in cards.iter().filter(|card| card.card_status == *column) {
            out.push_str(&format!("  #{} {}", card.id, card.title));
            out.push_str(match card.assignee {
                crate::domain::Assignee::Ai => " [AI]",
                crate::domain::Assignee::Human => " [User]",
            });
            if card.is_draft {
                out.push_str(" [draft]");
            }
            if card.assignee == crate::domain::Assignee::Ai && column == &Column::Doing {
                out.push_str(&format!(
                    " [{}]",
                    state_text(card.agent_status, card.pending_reason.as_deref())
                ));
            }
            out.push('\n');
        }
    }
    out
}

pub fn show_text(card: &Card) -> String {
    let mut out = format!(
        "#{} {}\nCard status: {}\nAssignee: {}\n",
        card.id,
        card.title,
        card.card_status.label(),
        match card.assignee {
            crate::domain::Assignee::Ai => "AI",
            crate::domain::Assignee::Human => "User",
        }
    );
    if card.assignee == crate::domain::Assignee::Ai && card.card_status == Column::Doing {
        out.push_str(&format!(
            "Agent status: {}\n",
            state_text(card.agent_status, card.pending_reason.as_deref())
        ));
    }
    if card.is_draft {
        out.push_str("Draft: yes\n");
    }
    if !card.description.is_empty() {
        out.push_str(&format!("Description:\n{}\n", card.description));
    }
    out.push_str("History:\n");
    for event in card.history.iter().rev() {
        let status = match event.kind {
            crate::domain::HistoryKind::Created | crate::domain::HistoryKind::Lane => {
                event.to_card_status.label()
            }
            crate::domain::HistoryKind::Agent => event.to_agent_status.label(),
        };
        out.push_str(&format!(
            "  {} {}: {}\n",
            status,
            match event.actor {
                crate::domain::Actor::Ai => "AI",
                crate::domain::Actor::Human => "User",
            },
            event.reason.as_deref().unwrap_or("")
        ));
    }
    out
}
