//! Codex: adds the data root to `sandbox_workspace_write.writable_roots` in the
//! user's `config.toml`. Only the workspace-write setup is changed. Any other
//! configuration is left as it is and reported with the manual step, and the
//! sandbox mode is never changed here. With `danger-full-access` nothing is
//! needed, so nothing is written.

use std::path::Path;

use toml_edit::{Array, DocumentMut, Item, Table, Value};

use super::plan::{Planned, invalid_file};
use crate::error::AgboardError;

const SUPPORTED_MODE: &str = "workspace-write";

/// The mode that runs every command outside the sandbox.
const FULL_ACCESS: &str = "danger-full-access";

/// Keys that select permission profiles or the legacy named profiles. The
/// writable-roots method cannot be mixed with either, so their presence stops
/// setup.
const PROFILE_KEYS: [&str; 4] = ["default_permissions", "permissions", "profile", "profiles"];

pub(crate) fn plan(
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
        return Ok(Planned::manual(format!(
            "{key} is set in {}. Permission profiles cannot be combined with writable_roots, so it was not changed. To let Codex edit the shared files, add \"{root}\" to the filesystem permissions of your permission profile, following the Codex configuration reference.",
            config.display()
        )));
    }

    match doc.get("sandbox_mode") {
        None => {
            return Ok(Planned::manual(format!(
                "sandbox_mode is not set in {}, so writable_roots would have no effect and it was not changed. To let Codex edit the shared files, set sandbox_mode = \"{SUPPORTED_MODE}\" there and run agboard setup again.",
                config.display()
            )));
        }
        Some(item) => match item.as_str() {
            Some(SUPPORTED_MODE) => {}
            Some(FULL_ACCESS) => return Ok(Planned::full_access()),
            Some(other) => {
                return Ok(Planned::manual(format!(
                    "sandbox_mode is \"{other}\" in {}, which does not let writable_roots take effect, so it was not changed. To let Codex edit the shared files, set sandbox_mode = \"{SUPPORTED_MODE}\" yourself and run agboard setup again.",
                    config.display()
                )));
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
                return Ok(Planned::default());
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

    Ok(Planned::change(
        doc.to_string(),
        format!("add \"{root}\" to sandbox_workspace_write.writable_roots"),
    ))
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
    fn profiles_and_other_modes_are_left_alone_with_a_manual_step() {
        for text in [
            "sandbox_mode = \"workspace-write\"\ndefault_permissions = \"p\"\n",
            "sandbox_mode = \"workspace-write\"\n[permissions.p]\n",
            "sandbox_mode = \"workspace-write\"\nprofile = \"p\"\n",
            "sandbox_mode = \"workspace-write\"\n[profiles.p]\n",
            "sandbox_mode = \"read-only\"\n",
            "model = \"gpt\"\n",
            "",
        ] {
            let planned = plan(Path::new("/c/config.toml"), Some(text), ROOT).unwrap();
            assert!(planned.text.is_none(), "{text:?}");
            assert!(planned.manual.is_some(), "{text:?}");
            assert!(!planned.full_access, "{text:?}");
        }
    }

    #[test]
    fn full_access_needs_nothing() {
        let text = "sandbox_mode = \"danger-full-access\"\n";
        let planned = plan(Path::new("/c/config.toml"), Some(text), ROOT).unwrap();
        assert!(planned.text.is_none());
        assert!(planned.manual.is_none());
        assert!(planned.full_access);
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
