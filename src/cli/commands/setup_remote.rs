//! `agboard setup remote`: save the ngrok connection settings, and the
//! optional ngrok step of plain `agboard setup`.
//!
//! The settings are global to the data area, so no project is needed. Storage
//! and validation are in [`crate::remote_settings`], which the interactive
//! questions, the saving options and the board's own dialog all share. This
//! starts and stops nothing.
//!
//! - `--domain`, `--clear-domain`, `--enabled`, `--token-stdin`: save at once, with no
//!   question, for scripts.
//! - No option: on a terminal, show the state and ask for the domain and the token
//!   (typed hidden), each skippable. Without a terminal nothing is asked and the
//!   command says what to add, as `agboard setup` does.

use std::io::{IsTerminal, Read};
use std::path::Path;

use serde_json::json;

use crate::cli::Outcome;
use crate::cli::args::SetupRemoteArgs;
use crate::error::AgboardError;
use crate::remote_settings::{self as saved, APPLIES_NOTE, Change, Saved};
use crate::server::monitor_connection::keychain::TokenVault;
use crate::server::monitor_connection::lifecycle::Secret;

/// A token is short; more than this on standard input is not one.
const MAX_STDIN: u64 = 4096;

/// Run the command. `None` means the user answered the questions and the
/// terminal already shows the result.
pub fn run(
    data_dir: &Path,
    args: &SetupRemoteArgs,
    json: bool,
    vault: &dyn TokenVault,
    stdin: &mut dyn Read,
) -> Result<Option<Outcome>, AgboardError> {
    if args.saves() {
        let change = Change {
            domain: if args.clear_domain {
                Some(None)
            } else {
                args.domain
                    .as_deref()
                    .map(saved::domain_of)
                    .transpose()?
                    .map(Some)
            },
            enabled: args.enabled,
            token: if args.token_stdin {
                Some(read_token(stdin)?)
            } else {
                None
            },
        };
        return Ok(Some(save(data_dir, vault, change)?));
    }
    let terminal = std::io::stdin().is_terminal() && std::io::stderr().is_terminal();
    if json || !terminal {
        return Err(AgboardError::InvalidArgument {
            message: "setup remote asks questions and needs a terminal for it. Without a terminal or with --json, add --domain, --clear-domain, --enabled, or --token-stdin to save them.".to_string(),
            command: Some("setup".to_string()),
        });
    }
    let _ = cliclack::intro("agboard setup remote");
    ask(data_dir, vault)?;
    Ok(None)
}

fn save(data_dir: &Path, vault: &dyn TokenVault, change: Change) -> Result<Outcome, AgboardError> {
    let now = saved::apply(data_dir, vault, change)?;
    let mut json = now.to_json();
    json["saved"] = json!(true);
    json["note"] = json!(APPLIES_NOTE);
    Ok(Outcome {
        // Nothing on a board changed, so there is no project to notify.
        changed: false,
        human: format!(
            "Saved the ngrok connection settings.\n{}{APPLIES_NOTE}\n",
            now.human()
        ),
        json,
    })
}

fn read_token(stdin: &mut dyn Read) -> Result<Secret, AgboardError> {
    let mut bytes = Vec::new();
    let invalid = |message: String| AgboardError::InvalidArgument {
        message,
        command: Some("setup".to_string()),
    };
    stdin
        .take(MAX_STDIN + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| {
            invalid(format!(
                "cannot read the token from standard input: {}.",
                e.kind()
            ))
        })?;
    let text = String::from_utf8_lossy(&bytes);
    if bytes.len() as u64 > MAX_STDIN || text.trim().is_empty() {
        return Err(invalid("--token-stdin needs the token on standard input, for example: printf '%s' \"$NGROK_AUTHTOKEN\" | agboard setup remote --token-stdin".to_string()));
    }
    saved::token_of(&text)
}

/// The answers of the questions: `None` leaves a setting as it is.
#[derive(Default)]
pub struct Answers {
    /// `Some("")` clears the domain, as typed after choosing to change an existing one.
    pub domain: Option<String>,
    pub token: Option<String>,
}

/// Turn the answers into a save. Nothing is saved, and `None` is returned, when
/// there is nothing to change. Both answers are checked before anything is
/// written, so a bad one changes nothing.
pub fn apply_answers(
    data_dir: &Path,
    vault: &dyn TokenVault,
    answers: &Answers,
) -> Result<Option<Saved>, AgboardError> {
    let domain = match answers.domain.as_deref().map(str::trim) {
        None => None,
        Some("") => Some(None),
        Some(text) => Some(Some(saved::domain_of(text)?)),
    };
    let token = match answers.token.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(text) => Some(saved::token_of(text)?),
    };
    let change = Change {
        domain,
        enabled: None,
        token,
    };
    if change.is_empty() {
        return Ok(None);
    }
    saved::apply(data_dir, vault, change).map(Some)
}

/// The optional ngrok step of plain `agboard setup`: asks whether to set it up
/// and, if so, runs the same questions as `agboard setup remote`. A problem here
/// is reported and never fails the setup that already ran.
pub fn offer(data_dir: &Path, vault: &dyn TokenVault) {
    let current = saved::read(data_dir, vault).ok();
    let question = if current
        .as_ref()
        .is_some_and(|s| s.domain.is_some() || s.token_saved == Some(true))
    {
        "Change the ngrok connection settings for the phone?"
    } else {
        "Set up the ngrok connection for the phone now? You can skip this and do it later with \"agboard setup remote\"."
    };
    if !matches!(
        cliclack::confirm(question).initial_value(false).interact(),
        Ok(true)
    ) {
        return;
    }
    if let Err(error) = ask(data_dir, vault) {
        let _ = cliclack::log::error(format!("{} {}", error.message(), error.reason()));
    }
}

/// The questions. Shows the current state first; an existing value is changed
/// only when the user says so, and each question can be skipped.
fn ask(data_dir: &Path, vault: &dyn TokenVault) -> Result<(), AgboardError> {
    let now = saved::read(data_dir, vault)?;
    let _ = cliclack::note("Saved ngrok settings", now.human());
    let mut answers = Answers::default();

    let change_domain = match &now.domain {
        Some(_) => confirm("Change the fixed domain?"),
        None => true,
    };
    if change_domain {
        let prompt = if now.domain.is_some() {
            "New fixed domain (empty removes it)"
        } else {
            "Fixed ngrok domain, such as example.ngrok-free.dev (empty skips)"
        };
        let typed: Result<String, _> = cliclack::input(prompt)
            .required(false)
            .validate(|text: &String| {
                if text.trim().is_empty() || saved::domain_of(text).is_ok() {
                    Ok(())
                } else {
                    Err("Enter a host name only, without https://, a path, or a port.")
                }
            })
            .interact();
        match typed {
            // Empty means "skip" when nothing is saved, and "remove" when something is.
            Ok(text) if text.trim().is_empty() && now.domain.is_none() => {}
            Ok(text) => answers.domain = Some(text),
            Err(_) => return cancelled(),
        }
    }

    let change_token = if now.token_saved == Some(true) {
        confirm("Replace the saved token?")
    } else {
        true
    };
    if change_token {
        let typed = cliclack::password("ngrok authtoken (typed hidden; empty skips)")
            .mask('*')
            .allow_empty()
            .validate(|text: &String| {
                if text.trim().is_empty() || saved::token_of(text).is_ok() {
                    Ok(())
                } else {
                    Err("The token must not contain spaces.")
                }
            })
            .interact();
        match typed {
            Ok(text) => answers.token = Some(text),
            Err(_) => return cancelled(),
        }
    }

    match apply_answers(data_dir, vault, &answers)? {
        Some(now) => {
            let _ = cliclack::note("Saved", format!("{}\n{APPLIES_NOTE}", now.human()));
            let _ = cliclack::outro("Done.");
        }
        None => {
            let _ = cliclack::outro("Nothing was changed.");
        }
    }
    Ok(())
}

fn confirm(question: &str) -> bool {
    matches!(
        cliclack::confirm(question).initial_value(false).interact(),
        Ok(true)
    )
}

fn cancelled() -> Result<(), AgboardError> {
    let _ = cliclack::outro_cancel("Nothing was changed.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::monitor_connection::keychain::{NoKeychain, VaultError};
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
            Ok(())
        }
    }

    const TOKEN: &str = "tok_secret_value_123";

    fn args() -> SetupRemoteArgs {
        SetupRemoteArgs {
            domain: None,
            clear_domain: false,
            enabled: None,
            token_stdin: false,
        }
    }

    #[test]
    fn saving_options_save_and_never_print_the_token() {
        let dir = tempfile::tempdir().unwrap();
        let vault = MemoryVault::default();
        let mut stdin: &[u8] = format!("{TOKEN}\n").as_bytes().to_vec().leak();
        let out = run(
            dir.path(),
            &SetupRemoteArgs {
                domain: Some(" Example.ngrok-free.dev ".into()),
                enabled: Some(true),
                token_stdin: true,
                ..args()
            },
            false,
            &vault,
            &mut stdin,
        )
        .unwrap()
        .unwrap();
        assert_eq!(out.json["domain"], "example.ngrok-free.dev");
        assert_eq!(out.json["enabled"], true);
        assert_eq!(out.json["tokenSaved"], true);
        assert!(out.human.contains("does not replace a running connection"));
        let shown = saved::read(dir.path(), &vault).unwrap();
        for text in [
            &out.human,
            &shown.human(),
            &out.json.to_string(),
            &shown.to_json().to_string(),
        ] {
            assert!(!text.contains(TOKEN), "{text}");
        }
        let file =
            std::fs::read_to_string(dir.path().join(".internal/monitor-connection.json")).unwrap();
        assert!(!file.contains(TOKEN));
    }

    #[test]
    fn a_bad_domain_or_token_is_refused_and_nothing_is_saved() {
        let dir = tempfile::tempdir().unwrap();
        let vault = MemoryVault::default();
        let error = run(
            dir.path(),
            &SetupRemoteArgs {
                domain: Some("https://x.ngrok-free.dev".into()),
                ..args()
            },
            false,
            &vault,
            &mut std::io::empty(),
        )
        .err()
        .unwrap();
        assert_eq!(error.code(), "invalid_domain");
        let error = run(
            dir.path(),
            &SetupRemoteArgs {
                token_stdin: true,
                ..args()
            },
            false,
            &vault,
            &mut std::io::empty(),
        )
        .err()
        .unwrap();
        assert_eq!(error.code(), "invalid_argument");
        assert!(
            !dir.path()
                .join(".internal/monitor-connection.json")
                .exists()
        );
    }

    #[test]
    fn answers_skip_or_save_and_check_both_before_writing() {
        let dir = tempfile::tempdir().unwrap();
        let vault = MemoryVault::default();
        assert!(
            apply_answers(dir.path(), &vault, &Answers::default())
                .unwrap()
                .is_none()
        );
        assert!(
            apply_answers(
                dir.path(),
                &vault,
                &Answers {
                    domain: Some(String::new()),
                    token: Some("  ".into())
                }
            )
            .unwrap()
            .is_some_and(|s| s.domain.is_none())
        );
        let error = apply_answers(
            dir.path(),
            &vault,
            &Answers {
                domain: Some("a.ngrok-free.dev".into()),
                token: Some("two words".into()),
            },
        )
        .unwrap_err();
        assert_eq!(error.code(), "invalid_argument");
        assert_eq!(saved::read(dir.path(), &vault).unwrap().domain, None);
        let now = apply_answers(
            dir.path(),
            &vault,
            &Answers {
                domain: Some("a.ngrok-free.dev".into()),
                token: Some(TOKEN.into()),
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(now.domain.as_deref(), Some("a.ngrok-free.dev"));
        assert_eq!(now.token_saved, Some(true));
    }

    #[test]
    fn without_a_terminal_and_without_options_nothing_is_asked() {
        let dir = tempfile::tempdir().unwrap();
        let error = run(
            dir.path(),
            &args(),
            true,
            &NoKeychain,
            &mut std::io::empty(),
        )
        .err()
        .unwrap();
        assert_eq!(error.code(), "invalid_argument");
        assert_eq!(error.exit_code(), 2);
    }
}
