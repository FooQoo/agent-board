//! Splitting a text into its frontmatter and body, reading the YAML, and joining them again.

use serde_yaml_ng::{Mapping, Value};

use crate::file_store::validate::Defect;

/// A document's Markdown and metadata syntax. Epic completion conditions are
/// ordinary body text; only `priority` is interpreted as document metadata.
pub struct ParsedDocument {
    pub body: String,
    pub defects: Vec<Defect>,
}

pub fn parse_document(text: &str) -> ParsedDocument {
    let text = text.replace("\r\n", "\n");
    match split(&text) {
        Split::None => ParsedDocument {
            body: text,
            defects: Vec::new(),
        },
        Split::Unclosed => ParsedDocument {
            body: text,
            defects: vec![defect(
                "frontmatter",
                "The frontmatter has no closing --- line.",
            )],
        },
        Split::Found { yaml, body } => ParsedDocument {
            body: body.to_string(),
            defects: read_yaml(yaml).err().into_iter().collect(),
        },
    }
}

/// The frontmatter of a text, as far as its lines go.
pub(in crate::file_store) enum Split<'a> {
    /// No opening line: the whole text is the body.
    None,
    /// The opening line has no closing line.
    Unclosed,
    /// The YAML text between the lines, and the body after the closing line.
    Found { yaml: &'a str, body: &'a str },
}

pub(in crate::file_store) fn split(text: &str) -> Split<'_> {
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

pub(super) fn defect(field: &str, reason: &str) -> Defect {
    Defect {
        field: field.into(),
        reason: reason.into(),
    }
}

/// The YAML of a frontmatter. Blank text is an empty mapping.
pub(in crate::file_store) fn read_yaml(yaml: &str) -> Result<Value, Defect> {
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

/// Join a frontmatter map and a body. An empty map leaves only the body.
pub(in crate::file_store) fn assemble(map: Mapping, body: &str) -> Result<String, Defect> {
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
