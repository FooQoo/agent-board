//! Text and JSON rendering shared by the commands.

use serde_json::Value;

use crate::clock::format_local_short;
use crate::domain::{Card, Column, RunState};

/// The card as JSON in the design's key order is guaranteed by the struct's
/// field order; [`render_json`] keeps it when the value is printed.
pub fn card_value(card: &Card) -> Value {
    serde_json::to_value(card).expect("a card is always valid JSON")
}

/// Key order of the JSON the CLI prints. `serde_json` sorts object keys
/// alphabetically unless its `preserve_order` feature is on, so objects are
/// printed with these keys first, in this order, and any other keys after them
/// in their stored order. One list works for every object because no object
/// uses two of these keys in a conflicting order.
const KEY_ORDER: [&str; 24] = [
    "error",
    "code",
    "message",
    "reason",
    "board",
    "card",
    "path",
    "cards",
    "url",
    "name",
    "next_card_id",
    "id",
    "title",
    "description",
    "column",
    "position",
    "run_state",
    "pending_reason",
    "created_at",
    "updated_at",
    "run_state_changed_at",
    "transitions",
    "from",
    "to",
];

fn key_rank(key: &str) -> usize {
    if key == "at" {
        return KEY_ORDER.len();
    }
    KEY_ORDER
        .iter()
        .position(|k| *k == key)
        .unwrap_or(KEY_ORDER.len() + 1)
}

/// Compact one-line JSON with the keys in the design's order.
pub fn render_json(value: &Value) -> String {
    let mut out = String::new();
    write_value(value, &mut out);
    out
}

fn write_value(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by_key(|(key, _)| key_rank(key));
            out.push('{');
            for (i, (key, value)) in entries.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(key).expect("a string is valid JSON"));
                out.push(':');
                write_value(value, out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(item, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

/// `running`, `idle`, or `pending: <reason>`.
pub fn state_text(state: RunState, reason: Option<&str>) -> String {
    match (state, reason) {
        (RunState::Pending, Some(reason)) => format!("pending: {reason}"),
        _ => state.as_str().to_string(),
    }
}

/// The `skan ls` listing: one section per column in `columns`. IDs and titles
/// are padded to the widest shown; only Doing cards show their run state.
pub fn ls_text(cards: &[Card], columns: &[Column]) -> String {
    let shown: Vec<&Card> = cards
        .iter()
        .filter(|c| columns.contains(&c.column))
        .collect();
    let id_width = shown
        .iter()
        .map(|c| format!("#{}", c.id).chars().count())
        .max()
        .unwrap_or(0);
    let title_width = shown
        .iter()
        .map(|c| c.title.chars().count())
        .max()
        .unwrap_or(0);
    let mut out = String::new();
    for column in columns {
        let in_column: Vec<&&Card> = shown.iter().filter(|c| c.column == *column).collect();
        out.push_str(&format!("{} ({})\n", column.label(), in_column.len()));
        if in_column.is_empty() {
            out.push_str("  (none)\n");
        }
        for card in in_column {
            let id = format!("#{}", card.id);
            let mut line = format!("  {id:<id_width$}  ");
            if card.column == Column::Doing {
                let pad = title_width - card.title.chars().count();
                line.push_str(&card.title);
                line.push_str(&" ".repeat(pad + 2));
                line.push_str(&state_text(card.run_state, card.pending_reason.as_deref()));
            } else {
                line.push_str(&card.title);
            }
            out.push_str(&line);
            out.push('\n');
        }
    }
    out
}

/// The `skan show` page for one card.
pub fn show_text(card: &Card) -> String {
    let mut out = format!("#{}  {}\n", card.id, card.title);
    out.push_str(&format!("Column:   {}\n", card.column.label()));
    out.push_str(&format!("State:    {}\n", card.run_state.as_str()));
    if card.run_state == RunState::Pending
        && let Some(reason) = &card.pending_reason
    {
        out.push_str(&format!("Reason:   {reason}\n"));
    }
    out.push_str(&format!(
        "Created:  {}\n",
        format_local_short(card.created_at)
    ));
    out.push_str(&format!(
        "Updated:  {}\n",
        format_local_short(card.updated_at)
    ));
    out.push('\n');
    if card.description.is_empty() {
        out.push_str("(no description)\n");
    } else {
        out.push_str(&card.description);
        out.push('\n');
    }
    out.push_str("\nHistory\n");
    for transition in &card.transitions {
        let label = match transition.from {
            None => format!("Created -> {}", transition.to.label()),
            Some(from) => format!("{} -> {}", from.label(), transition.to.label()),
        };
        out.push_str(&format!(
            "  {label:<15}   {}\n",
            format_local_short(transition.at)
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn render_json_uses_the_design_key_order_even_for_sorted_maps() {
        let board = json!({"created_at": "t", "next_card_id": 1, "name": "demo"});
        assert_eq!(
            render_json(&json!({"board": board, "cards": 8})),
            r#"{"board":{"name":"demo","next_card_id":1,"created_at":"t"},"cards":8}"#
        );
        assert_eq!(
            render_json(&json!({"cards": 8, "path": "/a/skan.json"})),
            r#"{"path":"/a/skan.json","cards":8}"#
        );
        assert_eq!(
            render_json(&json!({"at": "t", "to": "todo", "from": null})),
            r#"{"from":null,"to":"todo","at":"t"}"#
        );
    }

    #[test]
    fn render_json_escapes_strings_and_keeps_arrays_in_order() {
        assert_eq!(
            render_json(&json!({"cards": ["a\"b", 1, null, true]})),
            r#"{"cards":["a\"b",1,null,true]}"#
        );
    }

    #[test]
    fn state_text_shows_the_reason_only_for_pending() {
        assert_eq!(state_text(RunState::Pending, Some("why")), "pending: why");
        assert_eq!(state_text(RunState::Pending, None), "pending");
        assert_eq!(state_text(RunState::Running, None), "running");
    }
}
