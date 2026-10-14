//! TASK.md history codec. Acceptance and history defects are independent;
//! malformed YAML affects both without concealing the readable body.

use serde_yaml_ng::{Mapping, Value};

use super::frontmatter::{self, AcceptanceItem, Split};
use super::model::HistoryRecord;
use super::validate::{self, Defect};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseMode {
    /// Saved TASK.md must contain a nonempty history with a created event.
    Stored,
    /// Creation accepts absent or empty history; the product creates its events.
    NewInput,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedTask {
    pub body: String,
    pub acceptance: Vec<AcceptanceItem>,
    pub history: Vec<HistoryRecord>,
    pub frontmatter_defects: Vec<Defect>,
    pub acceptance_defects: Vec<Defect>,
    pub history_defects: Vec<Defect>,
}

impl ParsedTask {
    /// All defects, with their frontmatter field paths.
    pub fn defects(&self) -> Vec<Defect> {
        self.frontmatter_defects
            .iter()
            .chain(&self.acceptance_defects)
            .chain(&self.history_defects)
            .cloned()
            .collect()
    }
}

fn defect(field: impl Into<String>, reason: impl Into<String>) -> Defect {
    Defect {
        field: field.into(),
        reason: reason.into(),
    }
}

/// Read a TASK.md without mutating it. Invalid history is returned empty and
/// must never be used as a repair value by callers.
pub fn parse_task(text: &str, mode: ParseMode) -> ParsedTask {
    let acceptance = frontmatter::parse(text);
    let mut parsed = ParsedTask {
        body: acceptance.body,
        acceptance: acceptance.acceptance,
        history: Vec::new(),
        frontmatter_defects: Vec::new(),
        acceptance_defects: Vec::new(),
        history_defects: Vec::new(),
    };
    for d in acceptance.defects {
        if d.field == "frontmatter" {
            parsed.frontmatter_defects.push(d);
        } else {
            parsed.acceptance_defects.push(d);
        }
    }
    let normalized = text.replace("\r\n", "\n");
    let map = match frontmatter::split(&normalized) {
        Split::None => Mapping::new(),
        Split::Unclosed => return parsed,
        Split::Found { yaml, .. } => match frontmatter::read_yaml(yaml) {
            Ok(Value::Mapping(map)) => map,
            _ => return parsed,
        },
    };
    let list = match map.get("history") {
        None if mode == ParseMode::NewInput => return parsed,
        None => {
            parsed
                .history_defects
                .push(defect("history", "Saved TASK.md must contain history."));
            return parsed;
        }
        Some(Value::Sequence(list)) => list,
        _ => {
            parsed
                .history_defects
                .push(defect("history", "history must be a list."));
            return parsed;
        }
    };
    if mode == ParseMode::NewInput {
        if !list.is_empty() {
            parsed
                .history_defects
                .push(defect("history", "Creation input cannot import history."));
        }
        return parsed;
    }
    let mut event_indices = Vec::new();
    for (index, value) in list.iter().enumerate() {
        match serde_yaml_ng::from_value::<HistoryRecord>(value.clone()) {
            Ok(event) => {
                parsed.history.push(event);
                event_indices.push(index);
            }
            Err(error) => {
                let message = error.to_string();
                // serde reports a missing/unknown field by name. For typed
                // errors, deserialize each field to locate the offending key.
                let key = invalid_field(value).or_else(|| {
                    message
                        .split('`')
                        .nth(1)
                        .filter(|_| message.contains("field"))
                        .map(str::to_owned)
                });
                parsed.history_defects.push(defect(
                    key.map_or_else(
                        || format!("history[{index}]"),
                        |key| format!("history[{index}].{key}"),
                    ),
                    format!("The history event is invalid: {message}."),
                ));
            }
        }
    }
    parsed
        .history_defects
        .extend(
            validate::check_history(&parsed.history)
                .into_iter()
                .map(|mut d| {
                    if let Some(suffix) = d.field.strip_prefix("history[")
                        && let Some((index, rest)) = suffix.split_once(']')
                        && let Ok(index) = index.parse::<usize>()
                    {
                        d.field = format!("history[{}]{rest}", event_indices[index]);
                    }
                    d
                }),
        );
    if !parsed.history_defects.is_empty() {
        parsed.history.clear();
    }
    parsed
}

fn invalid_field(value: &Value) -> Option<String> {
    use super::model::{Choice, HistoryKind};
    use crate::domain::{Actor, Column, RunState};
    use serde::de::DeserializeOwned;

    let Value::Mapping(map) = value else {
        return None;
    };
    fn invalid<T: DeserializeOwned>(map: &Mapping, key: &str) -> bool {
        map.get(key)
            .is_some_and(|value| serde_yaml_ng::from_value::<T>(value.clone()).is_err())
    }
    for key in ["id", "at"] {
        if invalid::<String>(map, key) {
            return Some(key.into());
        }
    }
    for key in [
        "reason",
        "requestId",
        "question",
        "choiceId",
        "choiceLabel",
        "fromEpicId",
        "toEpicId",
    ] {
        if invalid::<Option<String>>(map, key) {
            return Some(key.into());
        }
    }
    for key in ["fromCardStatus"] {
        if invalid::<Option<Column>>(map, key) {
            return Some(key.into());
        }
    }
    for key in ["fromAgentStatus"] {
        if invalid::<Option<RunState>>(map, key) {
            return Some(key.into());
        }
    }
    if invalid::<Column>(map, "toCardStatus") {
        return Some("toCardStatus".into());
    }
    if invalid::<RunState>(map, "toAgentStatus") {
        return Some("toAgentStatus".into());
    }
    if invalid::<Actor>(map, "actor") {
        return Some("actor".into());
    }
    if invalid::<HistoryKind>(map, "kind") {
        return Some("kind".into());
    }
    if invalid::<Option<Vec<Choice>>>(map, "choices") {
        return Some("choices".into());
    }
    if invalid::<Option<bool>>(map, "isDraft") {
        return Some("isDraft".into());
    }
    if map
        .get("at")
        .and_then(Value::as_str)
        .is_some_and(|at| crate::clock::parse_utc(at).is_err())
    {
        return Some("at".into());
    }
    None
}

/// Replace the events while preserving all other frontmatter keys. Body and
/// acceptance use the same rules as PLAN.md's existing composer. This codec
/// validates supplied history; stored-file validation is the caller's duty.
pub fn compose_task(
    original: &str,
    body: &str,
    acceptance: Option<&[AcceptanceItem]>,
    events: &[HistoryRecord],
) -> Result<String, Defect> {
    if let Some(d) = validate::check_history(events).into_iter().next() {
        return Err(d);
    }
    let composed = frontmatter::compose(original, body, acceptance)?;
    let mut map = match frontmatter::split(&composed) {
        Split::None => Mapping::new(),
        Split::Found { yaml, .. } => match frontmatter::read_yaml(yaml)? {
            Value::Mapping(map) => map,
            _ => unreachable!("read_yaml returns mappings"),
        },
        Split::Unclosed => unreachable!("compose rejects unclosed frontmatter"),
    };
    let value =
        serde_yaml_ng::to_value(events).map_err(|error| defect("history", error.to_string()))?;
    map.insert(Value::String("history".into()), value);
    frontmatter::assemble(map, body)
}
