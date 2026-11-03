//! connect and update on a terminal: cliclack prompts (arrow keys, Space,
//! Enter; Esc or Ctrl-C cancels) and lines marked by what they are. Paths
//! under the home folder are shown with `~`. cliclack writes to standard
//! error and follows `NO_COLOR` and `TERM=dumb`.

use std::io;
use std::path::{Path, PathBuf};

use super::clack_view as view;
use super::{End, Tone, Ui};
use crate::integrations::apply::AgentOutcome;
use crate::integrations::plan::AgentPlan;
use crate::integrations::prompt::{AgentChoice, Reply};
use crate::integrations::registry::InstallationRecord;
use crate::integrations::types::{Agent, Scope};

pub struct ClackUi {
    home: Option<PathBuf>,
    /// The command, for the line that says how to try again.
    command: &'static str,
}

impl ClackUi {
    pub fn new(command: &'static str, home: Option<PathBuf>) -> Self {
        ClackUi { home, command }
    }

    /// `text` with the home folder written as `~`.
    fn short(&self, text: &str) -> String {
        view::tilde(text.trim_matches('\n'), self.home.as_deref())
    }
}

/// A prompt's answer; Esc, Ctrl-C, and a lost terminal cancel.
fn answer<T>(result: io::Result<T>) -> Reply<T> {
    result.map_or(Reply::Cancel, Reply::Value)
}

impl Ui for ClackUi {
    fn intro(&mut self, title: &str, text: &str) {
        let _ = cliclack::intro(title);
        let _ = cliclack::log::info(self.short(text));
    }

    fn say(&mut self, tone: Tone, text: &str) {
        let text = self.short(text);
        let _ = match tone {
            Tone::Info => cliclack::log::info(text),
            Tone::Warning => cliclack::log::warning(text),
            Tone::Error => cliclack::log::error(text),
        };
    }

    fn problem(&mut self, text: &str) {
        let _ = cliclack::log::error(self.short(text));
    }

    fn select_agents(&mut self, choices: &[AgentChoice], default: &[Agent]) -> Reply<Vec<Agent>> {
        for c in choices.iter().filter(|c| !c.available) {
            let _ = cliclack::log::remark(format!("{}: {}", c.agent.label(), c.detail));
        }
        let mut select =
            cliclack::multiselect("Select agents to connect (Space to choose, Enter to go on)")
                .required(true);
        for c in choices.iter().filter(|c| c.available) {
            select = select.item(c.agent, c.agent.label(), self.short(&c.detail));
        }
        let initial: Vec<Agent> = choices
            .iter()
            .filter(|c| c.available && default.contains(&c.agent))
            .map(|c| c.agent)
            .collect();
        answer(select.initial_values(initial).interact())
    }

    fn select_scope(&mut self, title: &str, root: &Path, default: Scope) -> Reply<Scope> {
        let project = self.short(&root.display().to_string());
        answer(
            cliclack::select(format!(
                "{title} scope (one choice for every selected agent)"
            ))
            .item(Scope::Global, "Global", "your own agent settings")
            .item(Scope::Project, "Project", project)
            .initial_value(default)
            .interact(),
        )
    }

    fn confirm(&mut self, question: &str) -> bool {
        cliclack::confirm(question)
            .initial_value(false)
            .interact()
            .unwrap_or(false)
    }

    fn connect_plan(&mut self, plans: &[AgentPlan]) {
        view::connect_plan(plans, &|t| self.short(t), self.command);
    }

    fn connect_results(&mut self, outcomes: &[AgentOutcome], plans: &[AgentPlan], exit: i32) {
        view::connect_results(outcomes, plans, exit, &|t| self.short(t));
    }

    fn update_plan(&mut self, plan: &AgentPlan, records: &[InstallationRecord]) {
        view::update_plan(plan, records, &|t| self.short(t), self.command);
    }

    /// Each blocked agent was already shown with its reasons.
    fn update_blocked(&mut self, _plans: &[AgentPlan]) {}

    fn update_backups(&mut self) {
        let _ = cliclack::log::remark(view::BACKUPS);
    }

    fn update_results(&mut self, outcomes: &[AgentOutcome], plans: &[AgentPlan], exit: i32) {
        view::update_results(outcomes, plans, exit, &|t| self.short(t));
    }

    fn finish(&mut self, end: End, text: &str) {
        let text = self.short(text);
        let _ = match end {
            End::Done => cliclack::outro(text),
            End::Cancelled | End::Failed => cliclack::outro_cancel(text),
        };
    }
}
