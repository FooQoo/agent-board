//! The frontmatter of TASK.md and PLAN.md: the acceptance conditions it holds,
//! the body that follows it, and the composition that writes both back.
//!
//! A file starts with a `---` line, YAML, and a closing `---` line. Only the
//! `acceptance` key is read; other keys are kept as they are. A file without
//! the opening line is a body with no conditions. Defects are reported with the
//! item they concern, and the product never rewrites a file to fix them.

use serde::{Deserialize, Serialize};
use serde_yaml_ng::{Mapping, Value};

use super::validate::Defect;

/// The most characters a condition's text may have (after trimming).
pub const MAX_ACCEPTANCE_TEXT_CHARS: usize = 2_000;

/// One completion condition: `id` is `AC-<n>`, `done` is whether it is met.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceItem {
    pub id: String,
    pub text: String,
    pub done: bool,
}

/// What a text holds: the body after the frontmatter and the conditions in it.
/// A text with a defect has no conditions, and its body is the whole text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed {
    pub body: String,
    pub acceptance: Vec<AcceptanceItem>,
    pub defects: Vec<Defect>,
}

/// Items with their index in the list.
type IndexedItems = Vec<(usize, AcceptanceItem)>;

/// The frontmatter of a text, as far as its lines go.
enum Split<'a> {
    /// No opening line: the whole text is the body.
    None,
    /// The opening line has no closing line.
    Unclosed,
    /// The YAML text between the lines, and the body after the closing line.
    Found { yaml: &'a str, body: &'a str },
}

fn split(text: &str) -> Split<'_> {
    if !(text == "---" || text.starts_with("---\n")) {
        return Split::None;
    }
    let start = text.len().min(4);
    let mut pos = start;
    loop {
        let end = text[pos..].find('\n').map_or(text.len(), |i| pos + i);
        if &text[pos..end] == "---" {
            let yaml = &text[start..pos];
            let after = if end < text.len() {
                &text[end + 1..]
            } else {
                ""
            };
            // One blank line after the closing line is a separator, not body.
            let body = after.strip_prefix('\n').unwrap_or(after);
            return Split::Found { yaml, body };
        }
        if end >= text.len() {
            return Split::Unclosed;
        }
        pos = end + 1;
    }
}

fn defect(field: &str, reason: &str) -> Defect {
    Defect {
        field: field.into(),
        reason: reason.into(),
    }
}

/// Read a text: its body, its conditions, and every defect of its frontmatter.
/// CRLF is read like LF.
pub fn parse(text: &str) -> Parsed {
    let text = text.replace("\r\n", "\n");
    let (yaml, body) = match split(&text) {
        Split::None => {
            return Parsed {
                body: text.clone(),
                acceptance: Vec::new(),
                defects: Vec::new(),
            };
        }
        Split::Unclosed => {
            return with_defect(
                &text,
                defect("frontmatter", "The frontmatter has no closing --- line."),
            );
        }
        Split::Found { yaml, body } => (yaml, body),
    };
    let value = match read_yaml(yaml) {
        Ok(value) => value,
        Err(defect) => return with_defect(&text, defect),
    };
    let (indexed, mut defects) = match read_items(&value) {
        Ok(read) => read,
        Err(defect) => return with_defect(&text, defect),
    };
    defects.extend(check_items(&indexed));
    if !defects.is_empty() {
        return Parsed {
            body: text.clone(),
            acceptance: Vec::new(),
            defects,
        };
    }
    Parsed {
        body: body.to_string(),
        acceptance: indexed.into_iter().map(|(_, item)| item).collect(),
        defects,
    }
}

fn with_defect(text: &str, defect: Defect) -> Parsed {
    Parsed {
        body: text.to_string(),
        acceptance: Vec::new(),
        defects: vec![defect],
    }
}

/// The YAML of a frontmatter. Blank text is an empty mapping.
fn read_yaml(yaml: &str) -> Result<Value, Defect> {
    if yaml.trim().is_empty() {
        return Ok(Value::Mapping(Mapping::new()));
    }
    let value: Value = serde_yaml_ng::from_str(yaml).map_err(|e| {
        defect(
            "frontmatter",
            &format!("The frontmatter is not valid YAML: {e}."),
        )
    })?;
    match value {
        Value::Null => Ok(Value::Mapping(Mapping::new())),
        Value::Mapping(_) => Ok(value),
        _ => Err(defect(
            "frontmatter",
            "The frontmatter must be a YAML mapping.",
        )),
    }
}

/// The items of `acceptance`, each with its index. An item that is not a
/// mapping with the three keys is a defect, and its index is left out.
fn read_items(value: &Value) -> Result<(IndexedItems, Vec<Defect>), Defect> {
    let Value::Mapping(map) = value else {
        return Ok((Vec::new(), Vec::new()));
    };
    let list = match map.get("acceptance") {
        None | Some(Value::Null) => return Ok((Vec::new(), Vec::new())),
        Some(Value::Sequence(list)) => list,
        Some(_) => return Err(defect("acceptance", "acceptance must be a list.")),
    };
    let mut items = Vec::new();
    let mut defects = Vec::new();
    for (index, element) in list.iter().enumerate() {
        match read_item(index, element) {
            Ok(item) => items.push((index, item)),
            Err(mut found) => defects.append(&mut found),
        }
    }
    Ok((items, defects))
}

fn read_item(index: usize, element: &Value) -> Result<AcceptanceItem, Vec<Defect>> {
    let field = |key: &str| format!("acceptance[{index}].{key}");
    let Value::Mapping(map) = element else {
        return Err(vec![defect(
            &format!("acceptance[{index}]"),
            "An item must be a mapping with id, text, and done.",
        )]);
    };
    let mut defects = Vec::new();
    for key in map.keys() {
        let known = matches!(key.as_str(), Some("id" | "text" | "done"));
        if !known {
            let name = key.as_str().map_or_else(|| "?".to_string(), str::to_string);
            defects.push(defect(
                &field(&name),
                "This key is not known for a condition.",
            ));
        }
    }
    let id = string_field(map, "id", &field("id"), &mut defects);
    let text = string_field(map, "text", &field("text"), &mut defects);
    let done = match map.get("done") {
        Some(Value::Bool(done)) => Some(*done),
        Some(_) => {
            defects.push(defect(&field("done"), "done must be true or false."));
            None
        }
        None => {
            defects.push(defect(&field("done"), "done is missing."));
            None
        }
    };
    match (id, text, done) {
        (Some(id), Some(text), Some(done)) if defects.is_empty() => {
            Ok(AcceptanceItem { id, text, done })
        }
        _ => Err(defects),
    }
}

fn string_field(
    map: &Mapping,
    key: &str,
    field: &str,
    defects: &mut Vec<Defect>,
) -> Option<String> {
    match map.get(key) {
        Some(Value::String(text)) => Some(text.clone()),
        Some(_) => {
            defects.push(defect(field, &format!("{key} must be text.")));
            None
        }
        None => {
            defects.push(defect(field, &format!("{key} is missing.")));
            None
        }
    }
}

/// The checks shared by reading and writing: the ID's form and uniqueness, and
/// the length of each text. `indexed` keeps each item's place in the list.
fn check_items(indexed: &[(usize, AcceptanceItem)]) -> Vec<Defect> {
    let mut defects = Vec::new();
    let mut seen: Vec<&str> = Vec::new();
    for (index, item) in indexed {
        if !is_condition_id(&item.id) {
            defects.push(defect(
                &format!("acceptance[{index}].id"),
                "The ID must be AC- followed by a positive number without a leading zero.",
            ));
        } else if seen.contains(&item.id.as_str()) {
            defects.push(defect(
                &format!("acceptance[{index}].id"),
                "The ID is used by another condition.",
            ));
        } else {
            seen.push(&item.id);
        }
        let length = item.text.trim().chars().count();
        if length == 0 || length > MAX_ACCEPTANCE_TEXT_CHARS {
            defects.push(defect(
                &format!("acceptance[{index}].text"),
                "The text must be 1 to 2,000 characters after trimming.",
            ));
        }
    }
    defects
}

fn is_condition_id(text: &str) -> bool {
    let Some(digits) = text.strip_prefix("AC-") else {
        return false;
    };
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) && !digits.starts_with('0')
}

/// Check conditions the caller is about to write. The field names count from
/// the list's first item, as they do when reading.
pub fn validate_items(items: &[AcceptanceItem]) -> Vec<Defect> {
    let indexed: Vec<(usize, AcceptanceItem)> = items.iter().cloned().enumerate().collect();
    check_items(&indexed)
}

/// Write a text: `acceptance` replaces the conditions when it is given, and
/// `body` replaces the body. The other frontmatter keys of `original` stay.
/// `acceptance` is written first. A frontmatter that cannot be read is an error,
/// so nothing is written over it.
pub fn compose(
    original: &str,
    body: &str,
    acceptance: Option<&[AcceptanceItem]>,
) -> Result<String, Defect> {
    if let Some(first) = acceptance.and_then(|items| validate_items(items).into_iter().next()) {
        return Err(first);
    }
    let original = original.replace("\r\n", "\n");
    let mut map = match split(&original) {
        Split::None => Mapping::new(),
        Split::Unclosed => {
            return Err(defect(
                "frontmatter",
                "The frontmatter has no closing --- line.",
            ));
        }
        Split::Found { yaml, .. } => match read_yaml(yaml)? {
            Value::Mapping(map) => map,
            _ => unreachable!("read_yaml returns a mapping"),
        },
    };
    if let Some(items) = acceptance {
        map.shift_remove("acceptance");
        let list: Vec<Value> = items.iter().map(item_value).collect();
        let mut front = Mapping::new();
        front.insert(Value::String("acceptance".into()), Value::Sequence(list));
        for (key, value) in map {
            front.insert(key, value);
        }
        map = front;
    }
    if map.is_empty() {
        return Ok(body.to_string());
    }
    let yaml = serde_yaml_ng::to_string(&Value::Mapping(map)).map_err(|e| {
        defect(
            "frontmatter",
            &format!("The frontmatter cannot be written: {e}."),
        )
    })?;
    let yaml = if yaml.ends_with('\n') {
        yaml
    } else {
        format!("{yaml}\n")
    };
    Ok(format!("---\n{yaml}---\n\n{body}"))
}

fn item_value(item: &AcceptanceItem) -> Value {
    let mut map = Mapping::new();
    map.insert(Value::String("id".into()), Value::String(item.id.clone()));
    map.insert(
        Value::String("text".into()),
        Value::String(item.text.clone()),
    );
    map.insert(Value::String("done".into()), Value::Bool(item.done));
    Value::Mapping(map)
}
