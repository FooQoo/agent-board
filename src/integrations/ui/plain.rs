//! The plain text of connect and update: lines on standard output, reasons on
//! standard error, and questions that read one line each. Used without a
//! terminal (`update --yes` in a pipe) and by tests that feed lines.

use std::io::{BufRead, Write};
use std::path::Path;

use super::{End, Tone, Ui};
use crate::integrations::apply::AgentOutcome;
use crate::integrations::plan::AgentPlan;
use crate::integrations::prompt::{AgentChoice, Prompter, Reply};
use crate::integrations::registry::InstallationRecord;
use crate::integrations::types::{Agent, Scope};
use crate::integrations::{report, update_report};

const BACKUPS: &str = "\nBackups: every existing file that changes is first copied next to the original (name.agboard-backup-...), and a Skill folder that changes is moved to .agboard-backups beside the skills folder. The copies are kept.\n\n";

pub struct PlainUi<'a> {
    prompter: Prompter<'a>,
    err: &'a mut dyn Write,
}

impl<'a> PlainUi<'a> {
    pub fn new(input: &'a mut dyn BufRead, out: &'a mut dyn Write, err: &'a mut dyn Write) -> Self {
        PlainUi {
            prompter: Prompter::new(input, out),
            err,
        }
    }
}

impl Ui for PlainUi<'_> {
    fn intro(&mut self, _title: &str, text: &str) {
        self.prompter.say(text);
    }

    fn say(&mut self, _tone: Tone, text: &str) {
        self.prompter.say(text);
    }

    fn problem(&mut self, text: &str) {
        let _ = self.err.write_all(text.as_bytes());
        let _ = self.err.flush();
    }

    fn select_agents(&mut self, choices: &[AgentChoice], default: &[Agent]) -> Reply<Vec<Agent>> {
        self.prompter.select_agents(choices, default)
    }

    fn select_scope(&mut self, title: &str, root: &Path, default: Scope) -> Reply<Scope> {
        self.prompter.select_scope(title, root, default)
    }

    fn confirm(&mut self, question: &str) -> bool {
        self.prompter.confirm(question)
    }

    fn connect_plan(&mut self, plans: &[AgentPlan]) {
        self.prompter.say(&report::summary(plans));
    }

    fn connect_results(&mut self, outcomes: &[AgentOutcome], plans: &[AgentPlan], exit: i32) {
        self.prompter.say("\n");
        self.prompter.say(&report::results(outcomes, plans, exit));
    }

    fn update_plan(&mut self, plan: &AgentPlan, records: &[InstallationRecord]) {
        self.prompter.say(&update_report::describe(plan, records));
    }

    fn update_blocked(&mut self, plans: &[AgentPlan]) {
        self.problem(&update_report::blocked_reasons(plans));
    }

    fn update_backups(&mut self) {
        self.prompter.say(BACKUPS);
    }

    fn update_results(&mut self, outcomes: &[AgentOutcome], plans: &[AgentPlan], exit: i32) {
        self.prompter.say("\n");
        let (shown, errors) = update_report::results(outcomes, plans, exit);
        self.prompter.say(&shown);
        self.problem(&errors);
    }

    fn finish(&mut self, _end: End, text: &str) {
        self.prompter.say(text);
    }
}
