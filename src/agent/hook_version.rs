//! The plugin's version check. The Hook command of the Agent Board plugin names
//! the plugin's version (`agboard hook --plugin-version X`). When it is not the
//! version of this `agboard`, the session start tells the agent to ask the user
//! to run `agboard update`. Nothing is read or written for the check.

use serde_json::Value;

/// The notice for a plugin of `plugin_version`, or `None` when it matches
/// `agboard_version` or no version was given.
pub fn notice(plugin_version: Option<&str>, agboard_version: &str) -> Option<String> {
    let plugin = plugin_version?.trim();
    if plugin.is_empty() || plugin == agboard_version {
        return None;
    }
    Some(format!(
        "AGBOARD_NOTICE\nThe Agent Board plugin is version {plugin}, but agboard is version {agboard_version}. Tell the user to run `agboard update` in a terminal to update the plugin, then start a new session."
    ))
}

/// Adds the notice to a SessionStart output of the Hook. Other events, and
/// output that is not the Hook's JSON, are returned as they are, so the
/// notice is shown once per session and never after each tool.
pub fn with_notice(output: String, plugin_version: Option<&str>, agboard_version: &str) -> String {
    let Some(notice) = notice(plugin_version, agboard_version) else {
        return output;
    };
    let Ok(mut value) = serde_json::from_str::<Value>(&output) else {
        return output;
    };
    let Some(specific) = value.get_mut("hookSpecificOutput") else {
        return output;
    };
    if specific.get("hookEventName").and_then(Value::as_str) != Some("SessionStart") {
        return output;
    }
    let context = specific
        .get("additionalContext")
        .and_then(Value::as_str)
        .unwrap_or_default();
    specific["additionalContext"] = Value::String(format!("{context}\n\n{notice}"));
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output(event: &str) -> String {
        serde_json::json!({"hookSpecificOutput":{"hookEventName":event,"additionalContext":"AGBOARD_PROGRESS\n{}"}}).to_string()
    }

    #[test]
    fn the_same_version_or_none_adds_nothing() {
        assert_eq!(notice(Some("1.2.0"), "1.2.0"), None);
        assert_eq!(notice(None, "1.2.0"), None);
        assert_eq!(notice(Some(""), "1.2.0"), None);
        let text = output("SessionStart");
        assert_eq!(with_notice(text.clone(), Some("1.2.0"), "1.2.0"), text);
    }

    #[test]
    fn another_version_adds_the_notice_at_session_start_only() {
        let out = with_notice(output("SessionStart"), Some("1.1.0"), "1.2.0");
        let value: Value = serde_json::from_str(&out).unwrap();
        let context = value["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .unwrap();
        assert!(context.starts_with("AGBOARD_PROGRESS\n{}"));
        assert!(context.contains("AGBOARD_NOTICE"));
        assert!(context.contains("version 1.1.0"));
        assert!(context.contains("`agboard update`"));
        let after_tool = output("PostToolUse");
        assert_eq!(
            with_notice(after_tool.clone(), Some("1.1.0"), "1.2.0"),
            after_tool
        );
    }
}
