//! Installing and updating the Agent Board plugin with the agents' own
//! commands. The repository is the marketplace of both agents; it is added
//! at the tag of this agboard's version, so the plugin matches the binary.
//! A marketplace added at another tag is removed and added again, which is how
//! both agents move a marketplace to a new tag.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::Agent;
use super::agent_cli::{self, CliOutput};

/// The marketplace name in both catalogs.
pub const MARKETPLACE: &str = "agent-board";
/// The plugin as both agents name it.
pub const PLUGIN_ID: &str = "agent-board@agent-board";
/// The repository that holds the marketplace. HTTPS, so no SSH key is needed.
pub const REPOSITORY: &str = "https://github.com/FooQoo/agent-board.git";

/// Where the plugin comes from: a Git repository at a tag, or a folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Source {
    pub location: String,
    /// The Git tag; `None` for a folder or the default branch.
    pub reference: Option<String>,
}

impl Source {
    /// The release tag of `version` in the Agent Board repository, unless
    /// `override_location` names another marketplace.
    pub fn for_version(version: &str, override_location: Option<String>) -> Source {
        match override_location {
            Some(location) => Source {
                location,
                reference: None,
            },
            None => Source {
                location: REPOSITORY.to_string(),
                reference: Some(format!("v{version}")),
            },
        }
    }

    /// For messages: the location and the tag.
    pub fn describe(&self) -> String {
        match &self.reference {
            Some(reference) => format!("{} at {reference}", self.location),
            None => self.location.clone(),
        }
    }
}

/// The plugin as `plugin list --json` reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Installed {
    pub version: String,
    /// The folder the agent installed it into, when the listing names one
    /// (`installPath`, or `path`). Without it only the version is known.
    pub path: Option<PathBuf>,
}

impl Installed {
    /// Whether the installed plugin is the one this agboard ships: the same
    /// files when the folder is known, else the same version.
    pub fn is_current(&self) -> bool {
        match &self.path {
            Some(path) => super::auto_update::installed_matches(path),
            None => self.version == super::VERSION,
        }
    }
}

/// The installed plugin, from `plugin list --json`. `None` when it is not
/// installed.
///
/// `codex_dir` is Codex's folder (`CODEX_HOME`). Codex's listing names no
/// install folder, so the installed copy is looked for in its plugin cache,
/// `<codex_dir>/plugins/cache/<marketplace>/<name>/<version>`, when that
/// folder exists. The listing's `source.path` is the marketplace checkout,
/// not the installed copy, and is never used.
pub fn installed(
    agent: Agent,
    program: &Path,
    codex_dir: Option<&Path>,
) -> Result<Option<Installed>, String> {
    let output = call(program, &["plugin", "list", "--json"], None)?;
    let value: Value = serde_json::from_str(&output.stdout).map_err(|error| {
        format!(
            "{} printed no JSON list ({error})",
            agent_cli::display(program, &["plugin", "list", "--json"])
        )
    })?;
    let (list, id_key) = match agent {
        Agent::Codex => (value.get("installed"), "pluginId"),
        Agent::Claude => (Some(&value), "id"),
    };
    let entry = list
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get(id_key).and_then(Value::as_str) == Some(PLUGIN_ID))
        })
        .map(|item| {
            let text = |key: &str| item.get(key).and_then(Value::as_str);
            let version = text("version").unwrap_or("unknown").to_string();
            let listed = ["installPath", "path"]
                .iter()
                .find_map(|key| text(key))
                .filter(|path| !path.is_empty())
                .map(PathBuf::from);
            let cached = || {
                let dir = codex_dir?
                    .join("plugins/cache")
                    .join(text("marketplaceName").unwrap_or(MARKETPLACE))
                    .join(text("name").unwrap_or("agent-board"))
                    .join(&version);
                dir.is_dir().then_some(dir)
            };
            let path = match agent {
                Agent::Claude => listed,
                Agent::Codex => listed.or_else(cached),
            };
            Installed { version, path }
        });
    Ok(entry)
}

/// Adds the marketplace from `source` and installs (or updates) the plugin.
/// Returns the commands that ran, in order.
pub fn install(agent: Agent, program: &Path, source: &Source) -> Result<Vec<String>, String> {
    let mut ran = Vec::new();
    add_marketplace(agent, program, source, &mut ran)?;
    let steps: &[&[&str]] = match agent {
        Agent::Codex => &[&["plugin", "add", PLUGIN_ID, "--json"]],
        Agent::Claude => &[
            &["plugin", "install", PLUGIN_ID, "--json"],
            &["plugin", "update", PLUGIN_ID, "--json"],
        ],
    };
    for args in steps {
        step(program, args, &mut ran)?;
    }
    Ok(ran)
}

fn add_marketplace(
    agent: Agent,
    program: &Path,
    source: &Source,
    ran: &mut Vec<String>,
) -> Result<(), String> {
    let pinned;
    let mut args: Vec<&str> = vec!["plugin", "marketplace", "add"];
    match (agent, &source.reference) {
        (Agent::Codex, Some(reference)) => {
            args.extend([source.location.as_str(), "--ref", reference.as_str()]);
        }
        (Agent::Claude, Some(reference)) => {
            pinned = format!("{}#{reference}", source.location);
            args.push(&pinned);
        }
        (_, None) => args.push(&source.location),
    }
    args.push("--json");
    let first = call(program, &args, Some(ran))?;
    if first.ok {
        return Ok(());
    }
    if !added_elsewhere(agent, &first) {
        return Err(failed(program, &args, &first));
    }
    // Added from another tag or place: remove it and add it again.
    step(
        program,
        &["plugin", "marketplace", "remove", MARKETPLACE, "--json"],
        ran,
    )?;
    step(program, &args, ran)
}

/// Whether a failed `marketplace add` means the marketplace is already known
/// from another source, the one failure that removing it fixes.
fn added_elsewhere(agent: Agent, output: &CliOutput) -> bool {
    let text = format!("{}\n{}", output.stdout, output.stderr);
    match agent {
        Agent::Codex => text.contains("already added from a different source"),
        Agent::Claude => {
            text.contains("\"failureCode\":\"declared\"") || text.contains("doesn't match")
        }
    }
}

fn step(program: &Path, args: &[&str], ran: &mut Vec<String>) -> Result<(), String> {
    let output = call(program, args, Some(ran))?;
    if output.ok {
        Ok(())
    } else {
        Err(failed(program, args, &output))
    }
}

fn call(program: &Path, args: &[&str], ran: Option<&mut Vec<String>>) -> Result<CliOutput, String> {
    if let Some(ran) = ran {
        ran.push(agent_cli::display(program, args));
    }
    agent_cli::run(program, args, None)
}

fn failed(program: &Path, args: &[&str], output: &CliOutput) -> String {
    format!(
        "{} failed: {}",
        agent_cli::display(program, args),
        output.reason()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_release_source_is_the_https_repository_at_the_version_tag() {
        let source = Source::for_version("1.2.3", None);
        assert_eq!(source.location, "https://github.com/FooQoo/agent-board.git");
        assert_eq!(source.reference.as_deref(), Some("v1.2.3"));
        let local = Source::for_version("1.2.3", Some("/src/agent-board".into()));
        assert_eq!(local.reference, None);
        assert_eq!(local.describe(), "/src/agent-board");
    }

    #[test]
    fn only_a_marketplace_from_another_source_is_removed_and_added_again() {
        let out = |stderr: &str| CliOutput {
            ok: false,
            stdout: String::new(),
            stderr: stderr.into(),
        };
        assert!(added_elsewhere(
            Agent::Codex,
            &out(
                "Error: marketplace 'agent-board' is already added from a different source; remove it"
            )
        ));
        assert!(!added_elsewhere(Agent::Codex, &out("network unreachable")));
        let claude = CliOutput {
            ok: false,
            stdout: r#"{"outcome":"failed","failureCode":"declared"}"#.into(),
            stderr: String::new(),
        };
        assert!(added_elsewhere(Agent::Claude, &claude));
        assert!(!added_elsewhere(Agent::Claude, &out("clone failed")));
    }
}
