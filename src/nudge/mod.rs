//! Nudges: reminders of what an agent tends to forget. One registry, [`RULES`],
//! feeds both the progress table (`reminders`, while the agent works) and the
//! Stop hook (the checklist at the end of a turn).
//!
//! A rule is one entry of the registry. A rule over the progress table alone
//! is a `State` rule; one that also needs the turn (the reply and the tool calls
//! read from the transcript) is a `Turn` rule. Add a rule by adding an entry to
//! [`rules::RULES`] and its cases to `cases.rs`; see "Add a rule" in
//! `docs/dev/concepts/agents.md`.

mod commands;
mod question_rules;
mod record_rules;
mod rules;
mod state_rules;
mod turn;

#[cfg(test)]
mod cases;
#[cfg(test)]
mod cases_question;
#[cfg(test)]
mod cases_state;
#[cfg(test)]
mod commands_tests;
#[cfg(test)]
mod coverage;
#[cfg(test)]
mod record_cases;
#[cfg(test)]
pub mod test_support;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod turn_tests;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::progress::Progress;

pub use commands::{ends_with_question, runs_agboard};
pub use rules::RULES;
pub use turn::{Call, Turn, read_turn};

/// The part of the product a rule is about. A new area is one new variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Area {
    /// Questions to the user and their answers.
    Question,
    /// Results and history: what the requester can see of the work.
    Record,
    /// Acceptance conditions and the lane a task is in.
    Acceptance,
    /// A task's run state and which task comes next.
    RunState,
    /// Epics and their documents.
    Epic,
}

/// What a rule reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// The progress table only. The rule never sees the turn, so it gives the
    /// same result in the table and in the Stop hook.
    State,
    /// The turn too: the reply and the tool calls of the turn.
    Turn,
}

/// Where a rule's results are shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum When {
    /// In the progress table, while the agent works. Only for `State` rules.
    Working,
    /// In the checklist of the Stop hook.
    TurnEnd,
    /// Both.
    Both,
}

impl When {
    fn in_table(self) -> bool {
        matches!(self, When::Working | When::Both)
    }
    fn at_turn_end(self) -> bool {
        matches!(self, When::TurnEnd | When::Both)
    }
}

/// How sure a rule is about what it reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// A fact the rule verified that is a violation.
    Definite,
    /// A trigger fired; the agent decides whether it applies.
    Check,
}

/// What a rule found, before the registry adds the rule's id and kind.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Finding {
    pub text: String,
    pub task_id: Option<i64>,
    pub message_id: Option<String>,
    pub epic_id: Option<String>,
}

impl Finding {
    pub fn new(text: impl Into<String>) -> Finding {
        Finding {
            text: text.into(),
            ..Finding::default()
        }
    }
    pub fn task(mut self, id: i64) -> Finding {
        self.task_id = Some(id);
        self
    }
    pub fn message(mut self, id: impl Into<String>) -> Finding {
        self.message_id = Some(id.into());
        self
    }
    pub fn epic(mut self, id: impl Into<String>) -> Finding {
        self.epic_id = Some(id.into());
        self
    }
}

/// One reminder: an item of `reminders` in the progress table and a line of the
/// Stop checklist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    /// The id of the rule that gave it.
    pub rule: &'static str,
    pub kind: Kind,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epic_id: Option<String>,
}

/// What a rule can look at.
#[derive(Clone, Copy)]
pub struct Facts<'a> {
    /// The bound project's progress table. `None` when it cannot be read.
    pub progress: Option<&'a Progress>,
    /// The turn as the transcript shows it. `None` when it cannot be read, and
    /// always `None` for a `State` rule.
    pub turn: Option<&'a Turn>,
    /// The reply text from the Stop input, when it has one.
    pub message: Option<&'a str>,
    pub now: DateTime<Utc>,
}

impl<'a> Facts<'a> {
    /// The last reply: from the input, else from the transcript.
    pub fn reply(&self) -> Option<&'a str> {
        let turn = self.turn;
        self.message
            .filter(|text| !text.trim().is_empty())
            .or_else(|| turn?.last_text.as_deref())
    }

    /// The tool calls of the turn, empty when it cannot be read.
    pub fn calls(&self) -> &'a [Call] {
        self.turn.map_or(&[], |t| &t.calls)
    }
}

/// One rule. Adding a rule is adding one entry to [`RULES`].
pub struct Rule {
    /// Stable kebab-case name, also the `rule` of its reminders and its row in
    /// the documentation.
    pub id: &'static str,
    pub area: Area,
    pub source: Source,
    pub when: When,
    pub kind: Kind,
    /// The findings that apply; none when the rule does not trigger.
    pub check: fn(&Facts) -> Vec<Finding>,
}

impl Rule {
    /// The rule's reminders for `facts`. A `State` rule sees no turn.
    pub fn run(&self, facts: &Facts) -> Vec<Reminder> {
        let facts = match self.source {
            Source::State => Facts {
                turn: None,
                message: None,
                ..*facts
            },
            Source::Turn => *facts,
        };
        (self.check)(&facts)
            .into_iter()
            .map(|f| Reminder {
                rule: self.id,
                kind: self.kind,
                text: f.text,
                task_id: f.task_id,
                message_id: f.message_id,
                epic_id: f.epic_id,
            })
            .collect()
    }
}

/// The `reminders` of the progress table: the `State` rules shown while the
/// agent works, in registry order.
pub fn state_reminders(progress: &Progress, now: DateTime<Utc>) -> Vec<Reminder> {
    let facts = Facts {
        progress: Some(progress),
        turn: None,
        message: None,
        now,
    };
    reminders(&facts, rules::RULES, |rule| {
        rule.source == Source::State && rule.when.in_table()
    })
}

/// The reminders of the Stop hook: every rule shown at the end of a turn.
pub fn turn_end_reminders(facts: &Facts, rules: &[Rule]) -> Vec<Reminder> {
    reminders(facts, rules, |rule| rule.when.at_turn_end())
}

fn reminders(facts: &Facts, rules: &[Rule], keep: impl Fn(&Rule) -> bool) -> Vec<Reminder> {
    rules
        .iter()
        .filter(|rule| keep(rule))
        .flat_map(|rule| rule.run(facts))
        .collect()
}
