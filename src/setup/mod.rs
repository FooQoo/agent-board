//! `agboard setup`: prepares the data directory and its shared folder, then
//! adds the data directory to the user settings of Codex and Claude Code.
//!
//! The run has two phases. Every target is planned first (read, validated, and
//! the new bytes computed), and nothing is written if any target fails. A real
//! run then writes; a dry run stops after the plan, so both share the same
//! checks. Project creation, binding, and serving are separate commands.

mod apply;
mod claude;
mod codex;
mod env;
mod plan;

use std::fs;
use std::path::PathBuf;

use serde_json::{Value, json};

pub use env::SetupEnv;

use crate::error::{AgboardError, FileAction};

/// An agent whose user settings setup can update.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Agent {
    Codex,
    Claude,
}

impl Agent {
    /// The name used in `--agent` and in JSON output.
    pub fn key(self) -> &'static str {
        match self {
            Agent::Codex => "codex",
            Agent::Claude => "claude",
        }
    }

    /// The name used in human-readable output.
    pub fn label(self) -> &'static str {
        match self {
            Agent::Codex => "Codex",
            Agent::Claude => "Claude Code",
        }
    }
}

/// What a run was asked to do.
#[derive(Debug, Clone)]
pub struct SetupOptions {
    pub agents: Vec<Agent>,
    pub dry_run: bool,
}

/// The outcome of one agent's settings file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Updated,
    Unchanged,
    Planned,
}

impl Status {
    pub fn key(self) -> &'static str {
        match self {
            Status::Updated => "updated",
            Status::Unchanged => "unchanged",
            Status::Planned => "planned",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AgentReport {
    pub agent: Agent,
    pub config_path: PathBuf,
    pub status: Status,
    pub changes: Vec<String>,
    pub backup_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct SetupReport {
    pub data_dir: PathBuf,
    pub shared_dir: PathBuf,
    pub dry_run: bool,
    pub agents: Vec<AgentReport>,
    pub restart_required: bool,
}

/// Runs setup. Returns what was done, or what a real run would do when
/// `dry_run` is set. Any failure is returned before the files are written.
pub fn run(env: &SetupEnv, options: &SetupOptions) -> Result<SetupReport, AgboardError> {
    let data_dir = env.data_dir()?;
    let root = data_dir
        .to_str()
        .ok_or_else(|| AgboardError::BoardUnavailable {
            reason: "The data directory path is not UTF-8. Set AGBOARD_HOME to a UTF-8 path."
                .into(),
        })?;
    let shared_dir = data_dir.join("shared");

    let mut agents = options.agents.clone();
    agents.dedup();
    let mut targets = Vec::with_capacity(agents.len());
    for agent in &agents {
        let config = match agent {
            Agent::Codex => env.codex_config()?,
            Agent::Claude => env.claude_settings()?,
        };
        targets.push(plan::plan(*agent, &config, root)?);
    }

    let backups = if options.dry_run {
        vec![None; targets.len()]
    } else {
        fs::create_dir_all(&shared_dir).map_err(|error| AgboardError::FileError {
            action: FileAction::Write,
            file: env::display(&shared_dir),
            reason: error.to_string(),
        })?;
        apply::apply(&targets)?
    };

    let agent_reports: Vec<AgentReport> = targets
        .into_iter()
        .zip(backups)
        .map(|(target, backup_path)| {
            let status = match (&target.planned, options.dry_run) {
                (None, _) => Status::Unchanged,
                (Some(_), true) => Status::Planned,
                (Some(_), false) => Status::Updated,
            };
            AgentReport {
                agent: target.agent,
                config_path: target.config_path,
                status,
                changes: target.changes,
                backup_path,
            }
        })
        .collect();
    let restart_required = agent_reports
        .iter()
        .any(|report| report.status != Status::Unchanged);
    Ok(SetupReport {
        data_dir,
        shared_dir,
        dry_run: options.dry_run,
        agents: agent_reports,
        restart_required,
    })
}

impl SetupReport {
    /// The JSON result: `dataDir`, `sharedDir`, `dryRun`, `agents`, and `restartRequired`.
    pub fn to_json(&self) -> Value {
        let agents: Vec<Value> = self
            .agents
            .iter()
            .map(|report| {
                json!({
                    "agent": report.agent.key(),
                    "configPath": env::display(&report.config_path),
                    "status": report.status.key(),
                    "changes": report.changes,
                    "backupPath": report.backup_path.as_deref().map(env::display),
                })
            })
            .collect();
        json!({
            "dataDir": env::display(&self.data_dir),
            "sharedDir": env::display(&self.shared_dir),
            "dryRun": self.dry_run,
            "agents": agents,
            "restartRequired": self.restart_required,
        })
    }

    /// The text result for a person, in English.
    pub fn to_human(&self) -> String {
        let mut text = String::new();
        if self.dry_run {
            text.push_str("Dry run: no files, folders, or backups were created.\n");
        }
        text.push_str(&format!(
            "Data directory: {}\n",
            env::display(&self.data_dir)
        ));
        text.push_str(&format!(
            "Shared folder: {}\n",
            env::display(&self.shared_dir)
        ));
        for report in &self.agents {
            let verb = match report.status {
                Status::Updated => "updated",
                Status::Unchanged => "unchanged",
                Status::Planned => "planned",
            };
            text.push_str(&format!(
                "{}: {verb} {}\n",
                report.agent.label(),
                env::display(&report.config_path)
            ));
            for change in &report.changes {
                text.push_str(&format!("  - {change}\n"));
            }
            if let Some(backup) = &report.backup_path {
                text.push_str(&format!("  backup: {}\n", env::display(backup)));
            }
        }
        if self.restart_required {
            text.push_str(
                "Start new Codex and Claude Code sessions to load the change. Project or managed settings can still limit the shared folder, so confirm access in a new session.\n",
            );
        }
        text
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::*;

    #[test]
    fn a_missing_home_is_reported_before_any_file_is_touched() {
        let env = SetupEnv {
            agboard_home: Some(OsString::from("/unused")),
            home: None,
            codex_home: None,
            claude_config_dir: None,
        };
        let options = SetupOptions {
            agents: vec![Agent::Claude],
            dry_run: false,
        };
        let error = run(&env, &options).unwrap_err();
        // Claude needs the home directory because CLAUDE_CONFIG_DIR is not set.
        assert_eq!(error.code(), "board_unavailable");
    }
}
