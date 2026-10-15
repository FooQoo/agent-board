//! Claude Code: adds the data root to `permissions.additionalDirectories` in
//! the user's `settings.json`. Only that array changes. Permission rules, the
//! permission mode, hooks, and unknown keys are kept as they are.

use std::path::Path;

use serde_json::{Value, json};

use super::plan::{Planned, invalid_file};
use crate::error::AgboardError;

pub(super) fn plan(
    settings: &Path,
    original: Option<&str>,
    root: &str,
) -> Result<Planned, AgboardError> {
    let mut value: Value = match original {
        None => json!({}),
        Some(text) => serde_json::from_str(text).map_err(|error| {
            invalid_file(
                settings,
                "",
                &format!(
                    "JSON syntax error: {error}. Setup does not repair files; fix the JSON and run setup again."
                ),
            )
        })?,
    };
    let object = value.as_object_mut().ok_or_else(|| {
        invalid_file(
            settings,
            "",
            "The top level must be a JSON object. Setup does not repair files.",
        )
    })?;
    let permissions = object
        .entry("permissions")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| invalid_file(settings, "permissions", "must be an object."))?;
    let directories = permissions
        .entry("additionalDirectories")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or_else(|| {
            invalid_file(
                settings,
                "permissions.additionalDirectories",
                "must be an array.",
            )
        })?;
    if directories.iter().any(|value| value.as_str().is_none()) {
        return Err(invalid_file(
            settings,
            "permissions.additionalDirectories",
            "must contain only strings.",
        ));
    }
    if directories.iter().any(|value| value.as_str() == Some(root)) {
        return Ok(Planned {
            text: None,
            changes: Vec::new(),
        });
    }
    directories.push(json!(root));

    let mut text = serde_json::to_string_pretty(&value).map_err(|error| {
        invalid_file(
            settings,
            "",
            &format!("Serializing the settings failed: {error}."),
        )
    })?;
    text.push('\n');
    Ok(Planned {
        text: Some(text),
        changes: vec![format!(
            "add \"{root}\" to permissions.additionalDirectories"
        )],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = "/srv/example/.agent-board";

    #[test]
    fn keeps_permissions_hooks_and_unknown_keys() {
        let text = r#"{"model":"opus","permissions":{"allow":["Read"],"ask":["Bash(git push:*)"],"deny":["Read(.env)"],"defaultMode":"acceptEdits","additionalDirectories":["/other"]},"hooks":{"Stop":[]},"futureKey":{"x":1}}"#;
        let result = plan(Path::new("/c/settings.json"), Some(text), ROOT)
            .unwrap()
            .text
            .unwrap();
        let value: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(value["model"], "opus");
        assert_eq!(value["futureKey"]["x"], 1);
        assert_eq!(value["hooks"], json!({"Stop": []}));
        assert_eq!(value["permissions"]["allow"], json!(["Read"]));
        assert_eq!(value["permissions"]["ask"], json!(["Bash(git push:*)"]));
        assert_eq!(value["permissions"]["deny"], json!(["Read(.env)"]));
        assert_eq!(value["permissions"]["defaultMode"], "acceptEdits");
        assert_eq!(
            value["permissions"]["additionalDirectories"],
            json!(["/other", ROOT])
        );
    }

    #[test]
    fn an_empty_object_gets_the_permissions_block() {
        let result = plan(Path::new("/c/settings.json"), None, ROOT).unwrap();
        let value: Value = serde_json::from_str(&result.text.unwrap()).unwrap();
        assert_eq!(
            value,
            json!({"permissions": {"additionalDirectories": [ROOT]}})
        );
    }

    #[test]
    fn an_existing_root_is_unchanged() {
        let text = format!(r#"{{"permissions":{{"additionalDirectories":["{ROOT}"]}}}}"#);
        let result = plan(Path::new("/c/settings.json"), Some(&text), ROOT).unwrap();
        assert!(result.text.is_none());
    }

    #[test]
    fn invalid_or_mis_shaped_settings_are_refused() {
        for text in [
            "",
            "not json",
            "[1]",
            r#"{"permissions":[]}"#,
            r#"{"permissions":{"additionalDirectories":"/x"}}"#,
            r#"{"permissions":{"additionalDirectories":[1]}}"#,
        ] {
            let error = plan(Path::new("/c/settings.json"), Some(text), ROOT).unwrap_err();
            assert_eq!(error.code(), "file_invalid", "{text:?}");
        }
    }
}
