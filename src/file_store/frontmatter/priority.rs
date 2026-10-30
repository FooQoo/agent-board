//! The `priority` list of EPIC.md: reading, checking and writing it.

use serde_yaml_ng::{Mapping, Value};

use super::split::{Split, assemble, defect, read_yaml, split};
use crate::file_store::validate::Defect;

/// The `priority` list of a text: the task IDs of an epic, in display order.
/// A missing key means no order. Entries must be positive integers, unique.
pub fn priority_of(text: &str) -> Result<Vec<i64>, Defect> {
    let text = text.replace("\r\n", "\n");
    let yaml = match split(&text) {
        Split::None => return Ok(Vec::new()),
        Split::Unclosed => {
            return Err(defect(
                "frontmatter",
                "The frontmatter has no closing --- line.",
            ));
        }
        Split::Found { yaml, .. } => yaml,
    };
    let Value::Mapping(map) = read_yaml(yaml)? else {
        unreachable!("read_yaml returns a mapping")
    };
    match map.get("priority") {
        None => Ok(Vec::new()),
        Some(value) => priority_from(value),
    }
}

fn priority_from(value: &Value) -> Result<Vec<i64>, Defect> {
    let Value::Sequence(items) = value else {
        return Err(priority_defect("The priority must be a list of task IDs."));
    };
    let mut ids = Vec::new();
    for item in items {
        let id = match item {
            Value::Number(number) => number.as_i64(),
            _ => None,
        }
        .filter(|id| *id > 0)
        .ok_or_else(|| priority_defect("Each priority entry must be a positive task ID."))?;
        if ids.contains(&id) {
            return Err(priority_defect(
                "A task ID appears more than once in priority.",
            ));
        }
        ids.push(id);
    }
    Ok(ids)
}

fn priority_defect(reason: &str) -> Defect {
    defect("priority", reason)
}

/// Check a priority list before it is written: positive IDs, no repeats.
pub fn validate_priority(ids: &[i64]) -> Result<(), Defect> {
    if ids.iter().any(|id| *id <= 0) {
        return Err(priority_defect(
            "Each priority entry must be a positive task ID.",
        ));
    }
    for (index, id) in ids.iter().enumerate() {
        if ids[..index].contains(id) {
            return Err(priority_defect(
                "A task ID appears more than once in priority.",
            ));
        }
    }
    Ok(())
}

/// Write a text's `priority` list. The other keys and the body stay; an empty
/// list removes the key. The list is checked first, and a frontmatter that
/// cannot be read is an error, so nothing is written over it.
pub fn compose_priority(original: &str, priority: &[i64]) -> Result<String, Defect> {
    validate_priority(priority)?;
    let original = original.replace("\r\n", "\n");
    let (mut map, body) = match split(&original) {
        Split::None => (Mapping::new(), original.clone()),
        Split::Unclosed => {
            return Err(defect(
                "frontmatter",
                "The frontmatter has no closing --- line.",
            ));
        }
        Split::Found { yaml, body } => match read_yaml(yaml)? {
            Value::Mapping(map) => (map, body.to_string()),
            _ => unreachable!("read_yaml returns a mapping"),
        },
    };
    if priority.is_empty() {
        map.shift_remove("priority");
    } else {
        let list: Vec<Value> = priority
            .iter()
            .map(|id| Value::Number((*id).into()))
            .collect();
        map.insert(Value::String("priority".into()), Value::Sequence(list));
    }
    assemble(map, &body)
}
