//! The result of a run, as JSON for programs and as text for a person.

use std::path::PathBuf;

use serde_json::{Value, json};

use super::{Agent, Mode, VERSION, env};

/// The outcome of one agent, or of one settings file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Updated,
    Unchanged,
    Planned,
    Skipped,
    Failed,
}

impl Status {
    pub fn key(self) -> &'static str {
        match self {
            Status::Updated => "updated",
            Status::Unchanged => "unchanged",
            Status::Planned => "planned",
            Status::Skipped => "skipped",
            Status::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone)]
pub struct FileReport {
    pub path: PathBuf,
    pub status: Status,
    pub changes: Vec<String>,
    pub backup_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct AgentReport {
    pub agent: Agent,
    pub status: Status,
    /// Why the agent was skipped or failed.
    pub reason: Option<String>,
    pub source: String,
    /// The plugin version before the run.
    pub installed: Option<String>,
    /// What happens to the plugin, in one line.
    pub plugin: String,
    pub files: Vec<FileReport>,
    /// The agent commands that ran, in order.
    pub steps: Vec<String>,
    /// For Codex: how many hooks were trusted now, `None` when not asked.
    pub trusted_hooks: Option<usize>,
    pub manual: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct SetupReport {
    pub mode: Mode,
    pub data_dir: PathBuf,
    pub shared_dir: PathBuf,
    pub dry_run: bool,
    pub agents: Vec<AgentReport>,
}

impl SetupReport {
    /// Whether an agent needs a new session to load a change (or would, for
    /// a dry run).
    pub fn restart_required(&self) -> bool {
        self.agents
            .iter()
            .any(|report| matches!(report.status, Status::Updated | Status::Planned))
    }

    /// 1 when an agent failed, or when setup could set up no agent at all;
    /// 0 otherwise.
    pub fn exit_code(&self) -> i32 {
        let failed = self.agents.iter().any(|r| r.status == Status::Failed);
        let none =
            self.mode == Mode::Setup && self.agents.iter().all(|r| r.status == Status::Skipped);
        i32::from(failed || none)
    }

    pub fn to_json(&self) -> Value {
        let agents: Vec<Value> = self
            .agents
            .iter()
            .map(|report| {
                let files: Vec<Value> = report
                    .files
                    .iter()
                    .map(|file| {
                        json!({
                            "path": env::display(&file.path),
                            "status": file.status.key(),
                            "changes": file.changes,
                            "backupPath": file.backup_path.as_deref().map(env::display),
                        })
                    })
                    .collect();
                json!({
                    "agent": report.agent.key(),
                    "status": report.status.key(),
                    "reason": report.reason,
                    "plugin": {
                        "source": report.source,
                        "installedVersion": report.installed,
                        "version": VERSION,
                        "action": report.plugin,
                    },
                    "files": files,
                    "steps": report.steps,
                    "trustedHooks": report.trusted_hooks,
                    "manualSteps": report.manual,
                })
            })
            .collect();
        json!({
            "dataDir": env::display(&self.data_dir),
            "sharedDir": env::display(&self.shared_dir),
            "dryRun": self.dry_run,
            "agents": agents,
            "restartRequired": self.restart_required(),
        })
    }

    pub fn to_human(&self) -> String {
        let mut text = String::new();
        if self.dry_run {
            text.push_str("Dry run: nothing was installed, created, or changed.\n");
        }
        text.push_str(&format!(
            "Data directory: {}\nShared folder: {}\n",
            env::display(&self.data_dir),
            env::display(&self.shared_dir)
        ));
        for report in &self.agents {
            text.push_str(&format!(
                "{}: {}\n",
                report.agent.label(),
                report.status.key()
            ));
            if let Some(reason) = &report.reason {
                text.push_str(&format!("  {reason}\n"));
            }
            if matches!(report.status, Status::Skipped) {
                continue;
            }
            text.push_str(&format!("  plugin: {}\n", report.plugin));
            for file in &report.files {
                text.push_str(&format!(
                    "  {} {}\n",
                    file.status.key(),
                    env::display(&file.path)
                ));
                for change in &file.changes {
                    text.push_str(&format!("    - {change}\n"));
                }
                if let Some(backup) = &file.backup_path {
                    text.push_str(&format!("    backup: {}\n", env::display(backup)));
                }
            }
            match report.trusted_hooks {
                Some(0) => text.push_str("  hooks: already trusted\n"),
                Some(count) => text.push_str(&format!("  hooks: trusted {count}\n")),
                None => {}
            }
            for step in &report.manual {
                text.push_str(&format!("  manual step: {step}\n"));
            }
        }
        if self.restart_required() {
            text.push_str(
                "Start a new agent session to load the plugin and the settings. Project or managed settings can still limit the shared folder, so confirm access in a new session.\n",
            );
        }
        text
    }
}
