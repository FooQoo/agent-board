//! Codex: adds the data root to `sandbox_workspace_write.writable_roots` in the
//! user's `config.toml`. Only the workspace-write setup is supported. Any other
//! configuration is refused before a write, with the manual steps, and the
//! sandbox mode is never changed here.

use std::path::Path;

use toml_edit::{Array, DocumentMut, Item, Table, Value};

use super::plan::{Planned, blocked, invalid_file};
use crate::error::AgboardError;

const SUPPORTED_MODE: &str = "workspace-write";

/// Keys that select permission profiles or the legacy named profiles. The
/// writable-roots method cannot be mixed with either, so their presence stops
/// setup.
const PROFILE_KEYS: [&str; 4] = ["default_permissions", "permissions", "profile", "profiles"];

pub(super) fn plan(
    config: &Path,
    original: Option<&str>,
    root: &str,
) -> Result<Planned, AgboardError> {
    let text = original.unwrap_or("");
    let mut doc: DocumentMut = text.parse().map_err(|error: toml_edit::TomlError| {
        invalid_file(
            config,
            "",
            &format!(
                "TOML syntax error: {}. Setup does not repair files; fix the syntax and run setup again.",
                error.message()
            ),
        )
    })?;

    if let Some(key) = PROFILE_KEYS.iter().find(|key| doc.contains_key(key)) {
        return Err(blocked(
            config,
            format!(
                "{key} is set. Permission profiles cannot be combined with writable_roots, so nothing was written. Manual setup: add \"{root}\" to the filesystem permissions of your permission profile, following the Codex configuration reference."
            ),
        ));
    }

    match doc.get("sandbox_mode") {
        None => {
            return Err(blocked(
                config,
                format!(
                    "sandbox_mode is not set, so writable_roots would have no effect. Nothing was written. Manual setup: set sandbox_mode = \"{SUPPORTED_MODE}\" in this file, then run setup again."
                ),
            ));
        }
        Some(item) => match item.as_str() {
            Some(SUPPORTED_MODE) => {}
            Some(other) => {
                return Err(blocked(
                    config,
                    format!(
                        "sandbox_mode is \"{other}\", which does not allow writable_roots to take effect. Nothing was written and the mode was not changed. Manual setup: set sandbox_mode = \"{SUPPORTED_MODE}\" yourself if the shared folder must be writable, then run setup again."
                    ),
                ));
            }
            None => {
                return Err(invalid_file(config, "sandbox_mode", "must be a string."));
            }
        },
    }

    if let Some(section) = doc.get("sandbox_workspace_write") {
        let table = section
            .as_table_like()
            .ok_or_else(|| invalid_file(config, "sandbox_workspace_write", "must be a table."))?;
        if let Some(roots) = table.get("writable_roots") {
            let array = roots.as_array().ok_or_else(|| {
                invalid_file(
                    config,
                    "sandbox_workspace_write.writable_roots",
                    "must be an array.",
                )
            })?;
            if array.iter().any(|value| value.as_str().is_none()) {
                return Err(invalid_file(
                    config,
                    "sandbox_workspace_write.writable_roots",
                    "must contain only strings.",
                ));
            }
            if array.iter().any(|value| value.as_str() == Some(root)) {
                return Ok(Planned {
                    text: None,
                    changes: Vec::new(),
                });
            }
        }
    }

    if !doc.contains_key("sandbox_workspace_write") {
        doc.insert("sandbox_workspace_write", Item::Table(Table::new()));
    }
    let section = doc
        .get_mut("sandbox_workspace_write")
        .and_then(Item::as_table_like_mut)
        .ok_or_else(|| invalid_file(config, "sandbox_workspace_write", "must be a table."))?;
    if section.get("writable_roots").is_none() {
        section.insert("writable_roots", Item::Value(Value::Array(Array::new())));
    }
    let array = section
        .get_mut("writable_roots")
        .and_then(Item::as_array_mut)
        .ok_or_else(|| {
            invalid_file(
                config,
                "sandbox_workspace_write.writable_roots",
                "must be an array.",
            )
        })?;
    array.push(root);

    Ok(Planned {
        text: Some(doc.to_string()),
        changes: vec![format!(
            "add \"{root}\" to sandbox_workspace_write.writable_roots"
        )],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = "/srv/example/.agent-board";

    fn planned(text: &str) -> Option<String> {
        plan(Path::new("/c/config.toml"), Some(text), ROOT)
            .unwrap()
            .text
    }

    #[test]
    fn adds_the_root_and_keeps_comments_keys_and_other_roots() {
        let text = "# my settings\nmodel = \"gpt\"\nsandbox_mode = \"workspace-write\"\n\n[sandbox_workspace_write]\n# shared\nwritable_roots = [\"/other\"]\nnetwork_access = false\n";
        let out = planned(text).unwrap();
        assert!(out.contains("# my settings"));
        assert!(out.contains("# shared"));
        assert!(out.contains("network_access = false"));
        assert!(out.contains("model = \"gpt\""));
        assert!(out.contains("\"/other\""));
        assert!(out.contains(&format!("\"{ROOT}\"")));
        // the result is still valid TOML with both roots
        let doc: toml_edit::DocumentMut = out.parse().unwrap();
        let roots = doc["sandbox_workspace_write"]["writable_roots"]
            .as_array()
            .unwrap();
        assert_eq!(roots.len(), 2);
    }

    #[test]
    fn creates_the_section_when_only_the_mode_is_set() {
        let out = planned("sandbox_mode = \"workspace-write\"\n").unwrap();
        let doc: toml_edit::DocumentMut = out.parse().unwrap();
        assert_eq!(
            doc["sandbox_workspace_write"]["writable_roots"][0].as_str(),
            Some(ROOT)
        );
    }

    #[test]
    fn an_existing_root_is_unchanged() {
        let text = format!(
            "sandbox_mode = \"workspace-write\"\n[sandbox_workspace_write]\nwritable_roots = [\"{ROOT}\"]\n"
        );
        let result = plan(Path::new("/c/config.toml"), Some(&text), ROOT).unwrap();
        assert!(result.text.is_none());
        assert!(result.changes.is_empty());
    }

    #[test]
    fn profiles_and_other_modes_are_refused_without_a_write() {
        for text in [
            "sandbox_mode = \"workspace-write\"\ndefault_permissions = \"p\"\n",
            "sandbox_mode = \"workspace-write\"\n[permissions.p]\n",
            "sandbox_mode = \"workspace-write\"\nprofile = \"p\"\n",
            "sandbox_mode = \"workspace-write\"\n[profiles.p]\n",
            "sandbox_mode = \"read-only\"\n",
            "sandbox_mode = \"danger-full-access\"\n",
            "model = \"gpt\"\n",
            "",
        ] {
            let error = plan(Path::new("/c/config.toml"), Some(text), ROOT).unwrap_err();
            assert_eq!(error.code(), "file_error", "{text:?}");
        }
    }

    #[test]
    fn invalid_toml_and_wrong_shapes_are_refused() {
        for text in [
            "sandbox_mode = \"workspace-write\"\n[sandbox_workspace_write\n",
            "sandbox_mode = \"workspace-write\"\nsandbox_workspace_write = 3\n",
            "sandbox_mode = \"workspace-write\"\n[sandbox_workspace_write]\nwritable_roots = \"/x\"\n",
            "sandbox_mode = \"workspace-write\"\n[sandbox_workspace_write]\nwritable_roots = [1]\n",
        ] {
            let error = plan(Path::new("/c/config.toml"), Some(text), ROOT).unwrap_err();
            assert_eq!(error.code(), "file_invalid", "{text:?}");
        }
    }
}
