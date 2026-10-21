//! Where a saved ngrok token lives: the operating system's keychain.
//!
//! The token is stored only when the PC asks for it. Errors from the keychain
//! library are reduced to two fixed kinds here, because some of them carry the
//! stored bytes; nothing from them is ever shown or logged.

use super::types::Secret;

const SERVICE: &str = "agent-board";
const ACCOUNT: &str = "ngrok-authtoken";

/// Why a keychain operation did not happen. Carries no detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultError {
    /// There is no usable keychain here (no service, locked out, unsupported OS).
    Unavailable,
    /// The keychain is there but the operation failed.
    Failed,
}

/// A place that can hold one token between runs. Tests replace it.
pub trait TokenVault: Send + Sync {
    /// Whether a token can be saved here.
    fn available(&self) -> bool;
    /// The saved token, or `None` when nothing is saved.
    fn load(&self) -> Result<Option<Secret>, VaultError>;
    fn save(&self, token: &Secret) -> Result<(), VaultError>;
    /// Remove the saved token. Removing nothing is not an error.
    fn delete(&self) -> Result<(), VaultError>;
}

/// The operating system's keychain: Keychain on macOS, Credential Manager on
/// Windows, the Secret Service on Linux.
pub struct OsKeychain;

fn entry() -> Result<keyring::Entry, VaultError> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| classify(&e))
}

fn classify(error: &keyring::Error) -> VaultError {
    match error {
        keyring::Error::NoDefaultStore
        | keyring::Error::NoStorageAccess(_)
        | keyring::Error::PlatformFailure(_)
        | keyring::Error::NotSupportedByStore(_) => VaultError::Unavailable,
        _ => VaultError::Failed,
    }
}

impl TokenVault for OsKeychain {
    fn available(&self) -> bool {
        keyring::Entry::store_status().is_ok()
    }

    fn load(&self) -> Result<Option<Secret>, VaultError> {
        match entry()?.get_password() {
            Ok(value) if !value.is_empty() => Ok(Some(Secret::new(value))),
            Ok(_) => Ok(None),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(classify(&e)),
        }
    }

    fn save(&self, token: &Secret) -> Result<(), VaultError> {
        entry()?
            .set_password(token.expose())
            .map_err(|e| classify(&e))
    }

    fn delete(&self) -> Result<(), VaultError> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(classify(&e)),
        }
    }
}

/// No keychain at all. Used by runs that never offer saving (the legacy
/// `--remote-port` run) and by tests that must not touch the real keychain.
pub struct NoKeychain;

impl TokenVault for NoKeychain {
    fn available(&self) -> bool {
        false
    }
    fn load(&self) -> Result<Option<Secret>, VaultError> {
        Ok(None)
    }
    fn save(&self, _: &Secret) -> Result<(), VaultError> {
        Err(VaultError::Unavailable)
    }
    fn delete(&self) -> Result<(), VaultError> {
        Err(VaultError::Unavailable)
    }
}
