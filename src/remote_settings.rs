//! The saved ngrok connection settings, read and written from the command line.
//!
//! `agboard setup remote` and the optional step of `agboard setup` both go
//! through here, so they validate and store exactly as the board's connection
//! dialog does: the non-secret settings in
//! `<data-root>/.internal/monitor-connection.json` (the server's own
//! [`ConfigStore`], atomic and owner-only), and the token in the OS keychain
//! entry the board uses. The token is never printed, logged, or written to a
//! file.
//!
//! A running server keeps these settings in memory and re-reads the file when
//! its revision is not the one it holds, so every save here moves the revision
//! forward, including a save that only changes the token.

use std::sync::Arc;

use serde_json::{Value, json};

use crate::error::{AgboardError, FileAction};
use crate::server::monitor_connection::config::{ConfigError, ConfigStore};
use crate::server::monitor_connection::contracts::ConnectionConfig;
use crate::server::monitor_connection::keychain::{NoKeychain, OsKeychain, TokenVault};
use crate::server::monitor_connection::lifecycle::{Secret, parse_domain, parse_token};

/// The file, as the data area's users see it in messages.
const FILE: &str = ".internal/monitor-connection.json";

/// The vault the command line uses: the OS keychain. `AGBOARD_KEYCHAIN=none`
/// makes the keychain unavailable, so a test or a locked-down machine never
/// touches it.
pub fn vault_from_process() -> Arc<dyn TokenVault> {
    if std::env::var("AGBOARD_KEYCHAIN").is_ok_and(|v| v == "none") {
        Arc::new(NoKeychain)
    } else {
        Arc::new(OsKeychain)
    }
}

/// What is saved. Never holds the token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Saved {
    pub enabled: bool,
    pub domain: Option<String>,
    pub revision: u64,
    pub keychain_available: bool,
    /// Whether the keychain holds a token; `None` when it cannot be read.
    pub token_saved: Option<bool>,
}

impl Saved {
    pub fn to_json(&self) -> Value {
        json!({
            "enabled": self.enabled,
            "domain": self.domain,
            "tokenSaved": self.token_saved.unwrap_or(false),
            "keychainAvailable": self.keychain_available,
        })
    }

    pub fn token_text(&self) -> &'static str {
        match (self.token_saved, self.keychain_available) {
            (Some(true), _) => "saved in the keychain",
            (_, false) => "not saved (the keychain is not available here)",
            _ => "not saved",
        }
    }

    pub fn human(&self) -> String {
        format!(
            "Enabled: {}\nDomain: {}\nToken: {}\n",
            if self.enabled { "yes" } else { "no" },
            self.domain
                .as_deref()
                .unwrap_or("none (ngrok chooses an address at each start)"),
            self.token_text(),
        )
    }
}

/// What to change; `None` leaves a setting as it is.
#[derive(Default)]
pub struct Change {
    /// `Some(None)` clears the domain.
    pub domain: Option<Option<String>>,
    pub enabled: Option<bool>,
    pub token: Option<Secret>,
}

impl Change {
    pub fn is_empty(&self) -> bool {
        self.domain.is_none() && self.enabled.is_none() && self.token.is_none()
    }
}

/// A domain as typed, or `invalid_domain`.
pub fn domain_of(raw: &str) -> Result<String, AgboardError> {
    parse_domain(raw).ok_or(AgboardError::InvalidDomain)
}

/// A token as typed, or an `invalid_argument` that never echoes it.
pub fn token_of(raw: &str) -> Result<Secret, AgboardError> {
    parse_token(raw).ok_or_else(|| AgboardError::InvalidArgument {
        message: "the ngrok token is not valid: it must not be empty or contain spaces."
            .to_string(),
        command: Some("setup".to_string()),
    })
}

fn file_error(action: FileAction, error: &ConfigError) -> AgboardError {
    AgboardError::FileError {
        action,
        file: FILE.to_string(),
        reason: match error {
            ConfigError::Invalid => "the saved settings are not valid".to_string(),
            ConfigError::Io(kind) => kind.clone(),
        },
    }
}

fn vault_error() -> AgboardError {
    AgboardError::KeychainUnavailable {
        reason: "Secure storage on this computer is not available. Nothing was saved. Start the connection with NGROK_AUTHTOKEN in the environment, or enter the token in the board.".to_string(),
    }
}

/// The saved settings. A file that cannot be read is an error here.
pub fn read(data_dir: &std::path::Path, vault: &dyn TokenVault) -> Result<Saved, AgboardError> {
    let config = ConfigStore::new(data_dir)
        .load()
        .map_err(|e| file_error(FileAction::Read, &e))?;
    Ok(saved_of(&config, vault))
}

fn saved_of(config: &ConnectionConfig, vault: &dyn TokenVault) -> Saved {
    Saved {
        enabled: config.enabled,
        domain: config.domain.clone(),
        revision: config.revision,
        keychain_available: vault.available(),
        token_saved: vault.load().ok().map(|t| t.is_some()),
    }
}

/// Save `change`. The token goes to the keychain first; if the keychain cannot
/// take it, nothing is changed. The settings file is then replaced in one step
/// with the revision moved forward, so a running board notices. An unreadable
/// file is replaced, as the board's dialog does.
pub fn apply(
    data_dir: &std::path::Path,
    vault: &dyn TokenVault,
    change: Change,
) -> Result<Saved, AgboardError> {
    let store = ConfigStore::new(data_dir);
    let current = store.load().unwrap_or_default();
    if let Some(token) = &change.token {
        vault.save(token).map_err(|_| vault_error())?;
    }
    let next = ConnectionConfig {
        enabled: change.enabled.unwrap_or(current.enabled),
        revision: current.revision + 1,
        domain: match change.domain {
            Some(domain) => domain,
            None => current.domain,
        },
    };
    store
        .save(&next)
        .map_err(|e| file_error(FileAction::Write, &e))?;
    Ok(saved_of(&next, vault))
}

/// What a save does to a connection that is already up.
pub const APPLIES_NOTE: &str = "Saving does not replace a running connection. The settings apply the next time the connection starts.";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::monitor_connection::keychain::VaultError;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryVault(Mutex<Option<String>>);

    impl TokenVault for MemoryVault {
        fn available(&self) -> bool {
            true
        }
        fn load(&self) -> Result<Option<Secret>, VaultError> {
            Ok(self.0.lock().unwrap().clone().map(Secret::new))
        }
        fn save(&self, token: &Secret) -> Result<(), VaultError> {
            *self.0.lock().unwrap() = Some(token.expose().to_string());
            Ok(())
        }
        fn delete(&self) -> Result<(), VaultError> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    #[test]
    fn defaults_then_a_save_moves_the_revision_and_keeps_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let vault = MemoryVault::default();
        let first = read(dir.path(), &vault).unwrap();
        assert_eq!(
            (first.enabled, first.domain.clone(), first.revision),
            (false, None, 0)
        );
        assert_eq!(first.token_saved, Some(false));
        let saved = apply(
            dir.path(),
            &vault,
            Change {
                domain: Some(Some(domain_of(" Example.NGROK-free.dev ").unwrap())),
                ..Change::default()
            },
        )
        .unwrap();
        assert_eq!(saved.domain.as_deref(), Some("example.ngrok-free.dev"));
        assert_eq!(saved.revision, 1);
        let saved = apply(
            dir.path(),
            &vault,
            Change {
                enabled: Some(true),
                ..Change::default()
            },
        )
        .unwrap();
        assert!(saved.enabled);
        assert_eq!(saved.domain.as_deref(), Some("example.ngrok-free.dev"));
        let saved = apply(
            dir.path(),
            &vault,
            Change {
                domain: Some(None),
                ..Change::default()
            },
        )
        .unwrap();
        assert_eq!((saved.domain, saved.revision), (None, 3));
    }

    #[test]
    fn a_token_goes_only_to_the_vault_and_bumps_the_revision() {
        let dir = tempfile::tempdir().unwrap();
        let vault = MemoryVault::default();
        let saved = apply(
            dir.path(),
            &vault,
            Change {
                token: Some(token_of("tok_secret_value_123").unwrap()),
                ..Change::default()
            },
        )
        .unwrap();
        assert_eq!((saved.token_saved, saved.revision), (Some(true), 1));
        assert_eq!(
            vault.load().unwrap().unwrap().expose(),
            "tok_secret_value_123"
        );
        let text = std::fs::read_to_string(dir.path().join(FILE)).unwrap();
        assert!(!text.contains("tok_secret"), "{text}");
        assert!(!format!("{saved:?}{}", saved.to_json()).contains("tok_secret"));
    }

    #[test]
    fn an_unavailable_keychain_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let error = apply(
            dir.path(),
            &NoKeychain,
            Change {
                domain: Some(Some("a.ngrok-free.dev".into())),
                token: Some(token_of("tok_secret_value_123").unwrap()),
                ..Change::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.code(), "keychain_unavailable");
        assert!(!dir.path().join(FILE).exists());
    }

    #[test]
    fn bad_input_is_refused_without_echoing_the_token() {
        assert_eq!(
            domain_of("https://a.ngrok-free.dev").unwrap_err().code(),
            "invalid_domain"
        );
        let error = token_of("two words").unwrap_err();
        assert_eq!(error.code(), "invalid_argument");
        assert!(!error.message().contains("two words"));
        assert!(token_of("").is_err());
    }

    #[test]
    fn an_unreadable_file_is_reported_by_read_and_replaced_by_a_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "not json").unwrap();
        assert!(read(dir.path(), &NoKeychain).is_err());
        let saved = apply(
            dir.path(),
            &NoKeychain,
            Change {
                enabled: Some(true),
                ..Change::default()
            },
        )
        .unwrap();
        assert!(saved.enabled);
        assert!(read(dir.path(), &NoKeychain).is_ok());
    }
}
