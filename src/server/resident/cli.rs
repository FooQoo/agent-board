//! Everything Agent Board knows about the external agent CLIs: their names, how to find them,
//! how to check a login, how to list models, and the exact arguments of a headless launch.
//! Nothing outside this module names `claude` or `codex`.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use crate::error::AgboardError;
use crate::server::sessions::Tool;
use crate::setup::agent_cli;

/// Overrides the `claude` executable (tests point it at a fake script).
pub const CLAUDE_BIN_ENV: &str = "AGBOARD_CLAUDE_BIN";
/// Overrides the `codex` executable.
pub const CODEX_BIN_ENV: &str = "AGBOARD_CODEX_BIN";

/// The model aliases `claude` accepts; it has no command that lists them.
const CLAUDE_MODELS: [&str; 4] = ["opus", "sonnet", "haiku", "fable"];

/// The first instruction of a launched session. The detailed procedure lives in the skill.
pub fn prompt(project_name: &str) -> String {
    format!(
        "You were launched by Agent Board as a resident session for project \"{project_name}\". \
         Run `agboard skills resident` and read the part for a session the board launched. Do \
         not run `agboard wait`: the board sends you each piece of work as a message, one at a \
         time, when you are idle. Once you have read the skill, end your turn and wait for \
         the next message. Ask a person only on the board with `message ask`, never in the \
         chat. Stop only when the board stops you."
    )
}

/// The tool the launcher can start; `unknown` cannot be launched.
pub fn launchable(tool: Tool) -> Result<Tool, AgboardError> {
    match tool {
        Tool::ClaudeCode | Tool::Codex => Ok(tool),
        Tool::Unknown => Err(AgboardError::InvalidValue {
            field: "tool".to_string(),
            reason: "tool must be claude-code or codex.".to_string(),
        }),
    }
}

fn command_name(tool: Tool) -> &'static str {
    match tool {
        Tool::Codex => "codex",
        _ => "claude",
    }
}

/// Where the executables are found.
#[derive(Debug, Clone, Default)]
pub struct Executables {
    claude: Option<PathBuf>,
    codex: Option<PathBuf>,
    path: Option<OsString>,
    timeout: Duration,
}

/// How long the login check and the model list may take; a launch request waits for them.
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

impl Executables {
    /// `AGBOARD_CLAUDE_BIN` and `AGBOARD_CODEX_BIN` when set, else the server's `PATH`.
    pub fn from_env() -> Executables {
        let var = |name: &str| {
            std::env::var_os(name)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        };
        Executables {
            claude: var(CLAUDE_BIN_ENV),
            codex: var(CODEX_BIN_ENV),
            path: std::env::var_os("PATH"),
            timeout: CHECK_TIMEOUT,
        }
    }

    /// Explicit executables, for tests.
    pub fn fixed(claude: Option<PathBuf>, codex: Option<PathBuf>) -> Executables {
        Executables {
            claude,
            codex,
            path: None,
            timeout: CHECK_TIMEOUT,
        }
    }

    /// The same executables with another time limit for the CLI calls (tests shorten it).
    pub fn with_timeout(mut self, timeout: Duration) -> Executables {
        self.timeout = timeout;
        self
    }

    /// The executable of `tool`, or `agent_cli_missing`.
    pub fn find(&self, tool: Tool) -> Result<PathBuf, AgboardError> {
        let name = command_name(tool);
        let overridden = match tool {
            Tool::Codex => &self.codex,
            _ => &self.claude,
        };
        let found = match overridden {
            Some(path) => Some(path.clone()).filter(|path| path.is_file()),
            None => agent_cli::find_on_path(name, self.path.as_deref()),
        };
        found.ok_or_else(|| AgboardError::AgentCliMissing {
            tool: name.to_string(),
        })
    }

    /// The tool is installed and logged in, or the error that says which is not.
    pub fn check(&self, tool: Tool) -> Result<PathBuf, AgboardError> {
        let tool = launchable(tool)?;
        let program = self.find(tool)?;
        let logged_out = || AgboardError::AgentCliLoggedOut {
            tool: command_name(tool).to_string(),
        };
        let run = |args: &[&str]| agent_cli::run_with_timeout(&program, args, None, self.timeout);
        let answered = match tool {
            Tool::Codex => run(&["login", "status"]).map(|out| out.ok),
            _ => run(&["auth", "status"]).map(|out| {
                serde_json::from_str::<serde_json::Value>(out.stdout.trim())
                    .ok()
                    .and_then(|json| json.get("loggedIn").and_then(serde_json::Value::as_bool))
                    .unwrap_or(false)
            }),
        };
        let logged_in = match answered {
            Ok(logged_in) => logged_in,
            Err(reason) if reason.contains("did not finish") => {
                return Err(AgboardError::SessionLaunchFailed {
                    reason: format!("The login check of {}: {reason}.", command_name(tool)),
                });
            }
            Err(_) => false,
        };
        if logged_in {
            Ok(program)
        } else {
            Err(logged_out())
        }
    }

    /// The models to offer for `tool`. When the list cannot be read the list is empty and
    /// `reason` says why; the tool then launches with its own default model.
    pub fn models(&self, tool: Tool) -> Result<ModelList, AgboardError> {
        let tool = launchable(tool)?;
        let program = self.find(tool)?;
        if tool == Tool::ClaudeCode {
            return Ok(ModelList {
                models: CLAUDE_MODELS
                    .iter()
                    .map(|name| ModelOption {
                        id: (*name).to_string(),
                        label: (*name).to_string(),
                    })
                    .collect(),
                reason: None,
            });
        }
        Ok(match read_codex_models(&program, self.timeout) {
            Ok(models) => ModelList {
                models,
                reason: None,
            },
            Err(reason) => ModelList {
                models: Vec::new(),
                reason: Some(reason),
            },
        })
    }
}

fn read_codex_models(program: &Path, timeout: Duration) -> Result<Vec<ModelOption>, String> {
    let output = agent_cli::run_with_timeout(program, &["debug", "models"], None, timeout)?;
    if !output.ok {
        return Err(format!("codex debug models failed: {}", output.reason()));
    }
    parse_codex_models(&output.stdout)
}

/// The models with `visibility` `list` from the JSON of `codex debug models`.
pub fn parse_codex_models(text: &str) -> Result<Vec<ModelOption>, String> {
    let json: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|_| "The model list of codex is not valid JSON.".to_string())?;
    let models = json
        .get("models")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "The model list of codex has no models.".to_string())?;
    let text_of = |model: &serde_json::Value, key: &str| {
        model
            .get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    };
    Ok(models
        .iter()
        .filter(|model| text_of(model, "visibility").as_deref() == Some("list"))
        .filter_map(|model| {
            let id = text_of(model, "slug")?;
            let label = text_of(model, "display_name").unwrap_or_else(|| id.clone());
            Some(ModelOption { id, label })
        })
        .collect())
}

/// One model a person may choose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModelOption {
    pub id: String,
    pub label: String,
}

/// The models of a tool. An empty list with a `reason` means the list could not be read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModelList {
    pub models: Vec<ModelOption>,
    pub reason: Option<String>,
}

/// A model name that is safe to pass as an argument: it cannot be read as a flag.
pub fn valid_model(model: &str) -> bool {
    let mut chars = model.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && model.len() <= 64
        && model
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'/' | b'-'))
}

fn text(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

/// The arguments of an unattended Claude Code session over two-way stream-json: auto mode with
/// its prompts off (a refused action comes back as a denied tool result). The first instruction
/// is sent on standard input, not as an argument. `model` of `None` leaves the choice to the tool.
pub fn claude_args(model: Option<&str>) -> Vec<OsString> {
    let mut args = text(&[
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
    ]);
    if let Some(model) = model {
        args.extend(text(&["--model", model]));
    }
    args.extend(text(&[
        "--permission-mode",
        "auto",
        "--permission-prompts",
        "none",
    ]));
    args
}

/// The arguments of a Codex session over `codex app-server`. The sandbox, the review of what it
/// asks, the writable folders, and the model are parameters of `thread/start`, not arguments.
pub fn codex_args() -> Vec<OsString> {
    text(&["app-server"])
}

/// Whether the environment variable of the server's own agent session must not reach a child.
/// These would make the child's `agboard wait` take it for another tool. Variables that only
/// configure the CLI (its home folder and keys) are kept.
pub fn scrubbed(name: &str) -> bool {
    const KEPT: [&str; 3] = ["CODEX_HOME", "CODEX_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];
    if KEPT.contains(&name) {
        return false;
    }
    name == "CLAUDECODE"
        || name == "AGBOARD_RESIDENT_ID"
        || name.starts_with("CLAUDE_CODE_")
        || name.starts_with("CODEX_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_listed_codex_models_are_offered() {
        let json = r#"{"models":[
            {"slug":"gpt-a","display_name":"GPT A","visibility":"list"},
            {"slug":"gpt-b","display_name":"GPT B","visibility":"hide"},
            {"slug":"gpt-c","visibility":"list"}]}"#;
        let models = parse_codex_models(json).unwrap();
        assert_eq!(
            models,
            vec![
                ModelOption {
                    id: "gpt-a".into(),
                    label: "GPT A".into()
                },
                ModelOption {
                    id: "gpt-c".into(),
                    label: "gpt-c".into()
                },
            ]
        );
        assert!(parse_codex_models("not json").is_err());
        assert!(parse_codex_models("{}").is_err());
    }

    #[test]
    fn the_prompt_tells_the_session_not_to_wait_because_the_board_sends_work() {
        let text = prompt("demo");
        assert!(text.contains("\"demo\""));
        assert!(text.contains("agboard skills resident"));
        assert!(text.contains("Do not run `agboard wait`"));
        assert!(text.contains("end your turn"));
        assert!(text.contains("`message ask`"));
        assert!(text.contains("Stop only when the board stops you"));
    }

    #[test]
    fn model_names_cannot_be_flags() {
        assert!(valid_model("gpt-5.1-codex"));
        assert!(!valid_model("--help"));
        assert!(!valid_model(""));
        assert!(!valid_model("a b"));
    }

    #[test]
    fn session_variables_are_scrubbed_and_configuration_is_kept() {
        assert!(scrubbed("CLAUDECODE"));
        assert!(scrubbed("CLAUDE_CODE_SESSION_ID"));
        assert!(scrubbed("CODEX_THREAD_ID"));
        assert!(!scrubbed("CODEX_HOME"));
        assert!(!scrubbed("PATH"));
    }
}
