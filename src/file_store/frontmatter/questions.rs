//! The `questions` list of TASK.md: the question IDs a task waits on.

use serde_yaml_ng::{Mapping, Value};

use super::split::{Split, assemble, defect, read_yaml, split};
use crate::file_store::qa::question_number;
use crate::file_store::validate::Defect;

fn questions_defect(reason: &str) -> Defect {
    defect("questions", reason)
}

/// The `questions` list of a text. Omitted, `null` and an empty list all mean none. Each entry
/// is a `Q-<n>` string and appears once. A frontmatter that cannot be read is not reported
/// here: the acceptance check reports it.
pub fn questions_of(text: &str) -> Result<Vec<String>, Defect> {
    let text = text.replace("\r\n", "\n");
    let Split::Found { yaml, .. } = split(&text) else {
        return Ok(Vec::new());
    };
    let Ok(Value::Mapping(map)) = read_yaml(yaml) else {
        return Ok(Vec::new());
    };
    match map.get("questions") {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(value) => questions_from(value),
    }
}

fn questions_from(value: &Value) -> Result<Vec<String>, Defect> {
    let Value::Sequence(items) = value else {
        return Err(questions_defect(
            "questions must be a list of question IDs.",
        ));
    };
    let mut ids: Vec<String> = Vec::new();
    for item in items {
        let id = item
            .as_str()
            .filter(|id| question_number(id).is_some())
            .ok_or_else(|| questions_defect("Each entry of questions must be a Q-<n> ID."))?;
        if ids.iter().any(|seen| seen == id) {
            return Err(questions_defect(
                "A question ID appears more than once in questions.",
            ));
        }
        ids.push(id.to_string());
    }
    Ok(ids)
}

/// Write a text's `questions` list. The other keys and the body stay; an empty list removes the
/// key. A frontmatter that cannot be read is an error, so nothing is written over it.
pub fn compose_questions(original: &str, ids: &[String]) -> Result<String, Defect> {
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
    if ids.is_empty() {
        map.shift_remove("questions");
    } else {
        let list = ids.iter().map(|id| Value::String(id.clone())).collect();
        map.insert(Value::String("questions".into()), Value::Sequence(list));
    }
    assemble(map, &body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_and_writes_the_list() {
        let text = "---\nacceptance: []\nquestions: [Q-2, Q-10]\nhistory: []\n---\nBody\n";
        assert_eq!(questions_of(text).unwrap(), vec!["Q-2", "Q-10"]);
        let none = compose_questions(text, &[]).unwrap();
        assert!(!none.contains("questions"));
        assert!(none.contains("Body"));
        let again = compose_questions(&none, &["Q-3".to_string()]).unwrap();
        assert_eq!(questions_of(&again).unwrap(), vec!["Q-3"]);
    }

    #[test]
    fn rejects_bad_entries() {
        for bad in [
            "questions: Q-1",
            "questions: [Q-1, Q-1]",
            "questions: [12]",
            "questions: [Q-01]",
        ] {
            let text = format!("---\n{bad}\n---\n");
            assert_eq!(questions_of(&text).unwrap_err().field, "questions", "{bad}");
        }
        assert!(
            questions_of("---\nquestions: null\n---\n")
                .unwrap()
                .is_empty()
        );
        assert!(questions_of("no frontmatter").unwrap().is_empty());
    }
}
