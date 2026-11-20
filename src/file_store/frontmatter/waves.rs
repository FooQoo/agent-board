//! The task order of EPIC.md: the `waves` list, reading, checking and writing it.
//!
//! `waves` is a YAML list in which every item is one wave: a single task ID
//! (`566`) or several IDs separated by commas (`569,570,571`, quoted or not).
//! The tasks of one wave can run in parallel; a wave starts when every task of
//! the waves before it is done. Nested lists are not accepted.

use serde_yaml_ng::{Mapping, Value};

use super::split::{Split, assemble, defect, read_yaml, split};
use crate::file_store::validate::Defect;

/// The waves of a text, in order. A missing key means no order. Entries must
/// be positive integers, unique across all waves, and no wave may be empty.
pub fn waves_of(text: &str) -> Result<Vec<Vec<i64>>, Defect> {
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
    match map.get("waves") {
        Some(value) => waves_from("waves", value),
        None => Ok(Vec::new()),
    }
}

fn waves_from(field: &str, value: &Value) -> Result<Vec<Vec<i64>>, Defect> {
    let Value::Sequence(items) = value else {
        return Err(defect(field, "The order must be a list of waves."));
    };
    let mut waves = Vec::new();
    for item in items {
        let wave = match item {
            Value::Number(_) => vec![id_from(field, item)?],
            Value::String(text) => text
                .split(',')
                .map(|part| {
                    part.trim()
                        .parse::<i64>()
                        .ok()
                        .filter(|id| *id > 0)
                        .ok_or_else(|| defect(field, "Each entry must be a positive task ID."))
                })
                .collect::<Result<Vec<i64>, Defect>>()?,
            _ => {
                return Err(defect(
                    field,
                    "Each wave must be a task ID or task IDs separated by commas.",
                ));
            }
        };
        waves.push(wave);
    }
    check_ids(field, &waves)?;
    Ok(waves)
}

fn id_from(field: &str, item: &Value) -> Result<i64, Defect> {
    match item {
        Value::Number(number) => number.as_i64(),
        _ => None,
    }
    .filter(|id| *id > 0)
    .ok_or_else(|| defect(field, "Each entry must be a positive task ID."))
}

fn check_ids(field: &str, waves: &[Vec<i64>]) -> Result<(), Defect> {
    let mut seen: Vec<i64> = Vec::new();
    for id in waves.iter().flatten() {
        if *id <= 0 {
            return Err(defect(field, "Each entry must be a positive task ID."));
        }
        if seen.contains(id) {
            return Err(defect(field, "A task ID appears more than once."));
        }
        seen.push(*id);
    }
    Ok(())
}

/// Drop the empty waves of a list that is about to be written.
pub fn drop_empty_waves(waves: &[Vec<i64>]) -> Vec<Vec<i64>> {
    waves
        .iter()
        .filter(|wave| !wave.is_empty())
        .cloned()
        .collect()
}

/// Check waves before they are written: positive IDs, no repeats across waves.
pub fn validate_waves(waves: &[Vec<i64>]) -> Result<(), Defect> {
    check_ids("waves", waves)
}

/// Write a text's `waves` list. The other keys and the body stay; an empty list removes `waves` too. Empty waves are
/// dropped. The list is checked first, and a frontmatter that cannot be read
/// is an error, so nothing is written over it.
pub fn compose_waves(original: &str, waves: &[Vec<i64>]) -> Result<String, Defect> {
    let waves = drop_empty_waves(waves);
    validate_waves(&waves)?;
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
    if waves.is_empty() {
        map.shift_remove("waves");
    } else {
        let list: Vec<Value> = waves
            .iter()
            .map(|wave| match wave.as_slice() {
                [id] => Value::Number((*id).into()),
                ids => Value::String(ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",")),
            })
            .collect();
        map.insert(Value::String("waves".into()), Value::Sequence(list));
    }
    assemble(map, &body)
}
