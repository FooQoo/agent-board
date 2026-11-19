//! Who a `wait --until task` command is, as far as the board is told: a stable session key, the
//! tool it runs in, and whether the board launched it. Only these three values are sent; the
//! environment itself never is, and the key is a hash, not the agent's own session ID.
//!
//! - Origin: `AGBOARD_RESIDENT_ID` set (by the board's launcher) means `board`; otherwise `external`.
//! - Tool: `CLAUDECODE` or `CLAUDE_CODE_SESSION_ID` means `claude-code`; `CODEX_THREAD_ID`,
//!   `CODEX_SANDBOX` or `CODEX_SANDBOX_NETWORK_DISABLED` means `codex`; otherwise `unknown`.
//! - Key, first one present: `AGBOARD_RESIDENT_ID`, `CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`,
//!   else the parent process ID (the agent's shell, so it differs between commands of tools that
//!   start a shell per command; such a session shows up as several short-lived ones).

use sha2::{Digest, Sha256};

use crate::server::sessions::{Origin, Tool};

/// The attributes of one waiting session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SessionIdentity {
    pub key: String,
    pub tool: Tool,
    pub origin: Origin,
}

impl SessionIdentity {
    /// Read the identity from this process's environment.
    pub(crate) fn from_env() -> SessionIdentity {
        SessionIdentity::from_lookup(
            |name| std::env::var(name).ok(),
            std::os::unix::process::parent_id(),
        )
    }

    pub(crate) fn from_lookup(
        get: impl Fn(&str) -> Option<String>,
        parent_pid: u32,
    ) -> SessionIdentity {
        let value = |name: &str| get(name).filter(|text| !text.trim().is_empty());
        let resident = value("AGBOARD_RESIDENT_ID");
        let origin = if resident.is_some() {
            Origin::Board
        } else {
            Origin::External
        };
        let claude = value("CLAUDECODE").is_some() || value("CLAUDE_CODE_SESSION_ID").is_some();
        let codex = [
            "CODEX_THREAD_ID",
            "CODEX_SANDBOX",
            "CODEX_SANDBOX_NETWORK_DISABLED",
        ]
        .iter()
        .any(|name| value(name).is_some());
        let tool = if claude {
            Tool::ClaudeCode
        } else if codex {
            Tool::Codex
        } else {
            Tool::Unknown
        };
        let (source, id) = resident
            .map(|id| ("resident", id))
            .or_else(|| value("CLAUDE_CODE_SESSION_ID").map(|id| ("claude", id)))
            .or_else(|| value("CODEX_THREAD_ID").map(|id| ("codex", id)))
            .unwrap_or(("ppid", parent_pid.to_string()));
        SessionIdentity {
            key: key_of(source, &id),
            tool,
            origin,
        }
    }
}

/// `<source>:<first 16 hex digits of the SHA-256 of the value>`.
fn key_of(source: &str, value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    let hex: String = digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("{source}:{hex}")
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::server::sessions::valid_key;

    fn identity(pairs: &[(&str, &str)], ppid: u32) -> SessionIdentity {
        let env: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        SessionIdentity::from_lookup(|name| env.get(name).cloned(), ppid)
    }

    #[test]
    fn a_resident_id_means_the_board_started_the_session() {
        let found = identity(&[("AGBOARD_RESIDENT_ID", "r1"), ("CLAUDECODE", "1")], 7);
        assert_eq!(found.origin, Origin::Board);
        assert_eq!(found.tool, Tool::ClaudeCode);
        assert!(found.key.starts_with("resident:"));
    }

    #[test]
    fn claude_code_is_told_by_its_own_variables_and_keyed_by_its_session() {
        let found = identity(&[("CLAUDECODE", "1"), ("CLAUDE_CODE_SESSION_ID", "abc")], 7);
        assert_eq!(found.origin, Origin::External);
        assert_eq!(found.tool, Tool::ClaudeCode);
        assert_eq!(
            found.key,
            identity(&[("CLAUDE_CODE_SESSION_ID", "abc")], 99).key
        );
        assert!(found.key.starts_with("claude:"));
    }

    #[test]
    fn codex_is_told_by_its_thread() {
        let found = identity(&[("CODEX_THREAD_ID", "t-1")], 7);
        assert_eq!(found.tool, Tool::Codex);
        assert!(found.key.starts_with("codex:"));
    }

    #[test]
    fn the_companion_plugin_variable_is_not_codex() {
        let found = identity(&[("CODEX_COMPANION_SESSION_ID", "x")], 7);
        assert_eq!(found.tool, Tool::Unknown);
    }

    #[test]
    fn without_any_variable_the_parent_process_names_the_session() {
        let found = identity(&[], 4242);
        assert_eq!(found.tool, Tool::Unknown);
        assert_ne!(found.key, identity(&[], 4243).key);
        assert!(found.key.starts_with("ppid:"));
    }

    #[test]
    fn keys_are_valid_and_do_not_contain_the_id() {
        let found = identity(&[("CLAUDE_CODE_SESSION_ID", "very-secret-session")], 7);
        assert!(valid_key(&found.key));
        assert!(!found.key.contains("secret"));
    }
}
