//! The questions connect asks: which agents, which Skill scope, which Hook
//! scope, and the final y/N. Every question reads one line. End of input
//! (Ctrl-D) and `q` cancel; Enter takes the offered default. Nothing here
//! writes any file.

use std::io::{BufRead, Write};
use std::path::Path;

use super::types::{Agent, Scope};

/// The answer to a question.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reply<T> {
    Value(T),
    /// The person cancelled, or the input ended.
    Cancel,
}

/// One row of the agent list.
#[derive(Debug, Clone)]
pub struct AgentChoice {
    pub agent: Agent,
    /// What is shown after the name: the version, or why it is unavailable.
    pub detail: String,
    pub available: bool,
}

pub struct Prompter<'a> {
    input: &'a mut dyn BufRead,
    out: &'a mut dyn Write,
}

impl<'a> Prompter<'a> {
    pub fn new(input: &'a mut dyn BufRead, out: &'a mut dyn Write) -> Self {
        Prompter { input, out }
    }

    pub fn say(&mut self, text: &str) {
        let _ = self.out.write_all(text.as_bytes());
        let _ = self.out.flush();
    }

    /// One trimmed line, or `None` at the end of the input.
    fn line(&mut self) -> Option<String> {
        let mut buffer = Vec::new();
        match self.input.read_until(b'\n', &mut buffer) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(String::from_utf8_lossy(&buffer).trim().to_string()),
        }
    }

    /// The checkbox list of agents. Unavailable agents are shown with the
    /// reason and cannot be chosen. `default` is taken on Enter.
    pub fn select_agents(
        &mut self,
        choices: &[AgentChoice],
        default: &[Agent],
    ) -> Reply<Vec<Agent>> {
        let mark = |c: &AgentChoice| default.contains(&c.agent) && c.available;
        let mut list = String::from("Agents on this computer:\n");
        for (i, c) in choices.iter().enumerate() {
            let box_ = if !c.available {
                "[-]"
            } else if mark(c) {
                "[x]"
            } else {
                "[ ]"
            };
            list.push_str(&format!(
                "  {}) {box_} {:<12} {}\n",
                i + 1,
                c.agent.label(),
                c.detail
            ));
        }
        self.say(&list);
        let numbers: Vec<String> = choices
            .iter()
            .enumerate()
            .filter(|(_, c)| mark(c))
            .map(|(i, _)| (i + 1).to_string())
            .collect();
        let hint = if numbers.is_empty() {
            String::new()
        } else {
            format!(" [{}]", numbers.join(" "))
        };
        loop {
            self.say(&format!(
                "Select agents to connect (numbers separated by spaces, a for all available, q to cancel){hint}: "
            ));
            let Some(line) = self.line() else {
                return Reply::Cancel;
            };
            match parse_agents(&line, choices, default) {
                Ok(Some(agents)) => return Reply::Value(agents),
                Ok(None) => return Reply::Cancel,
                Err(message) => self.say(&format!("{message}\n")),
            }
        }
    }

    /// A single choice between Global and Project.
    pub fn select_scope(&mut self, title: &str, root: &Path, default: Scope) -> Reply<Scope> {
        let suffix = |s: Scope| if s == default { " (default)" } else { "" };
        self.say(&format!(
            "{title} scope (one choice for every selected agent):\n  1) Global   your own agent settings{}\n  2) Project  {}{}\n",
            suffix(Scope::Global),
            root.display(),
            suffix(Scope::Project),
        ));
        let hint = if default == Scope::Global { 1 } else { 2 };
        loop {
            self.say(&format!("{title} scope, 1 or 2 (q to cancel) [{hint}]: "));
            let Some(line) = self.line() else {
                return Reply::Cancel;
            };
            match line.to_lowercase().as_str() {
                "" => return Reply::Value(default),
                "1" | "g" | "global" => return Reply::Value(Scope::Global),
                "2" | "p" | "project" => return Reply::Value(Scope::Project),
                "q" | "quit" => return Reply::Cancel,
                _ => self.say("Enter 1 for Global, 2 for Project, or q to cancel.\n"),
            }
        }
    }

    /// The y/N question. Anything but `y` or `yes`, including the end of the
    /// input, is a no.
    pub fn confirm(&mut self, question: &str) -> bool {
        self.say(&format!("{question} [y/N] "));
        matches!(
            self.line().as_deref().map(str::to_lowercase).as_deref(),
            Some("y" | "yes")
        )
    }
}

/// `Ok(Some)` the chosen agents, `Ok(None)` cancel, `Err` a message to show.
fn parse_agents(
    line: &str,
    choices: &[AgentChoice],
    default: &[Agent],
) -> Result<Option<Vec<Agent>>, String> {
    let words: Vec<&str> = line
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|w| !w.is_empty())
        .collect();
    if words.is_empty() {
        let kept: Vec<Agent> = choices
            .iter()
            .filter(|c| c.available && default.contains(&c.agent))
            .map(|c| c.agent)
            .collect();
        return if kept.is_empty() {
            Err("Choose at least one agent, or q to cancel.".into())
        } else {
            Ok(Some(kept))
        };
    }
    let mut chosen: Vec<Agent> = Vec::new();
    for word in words {
        match word.to_lowercase().as_str() {
            "q" | "quit" => return Ok(None),
            "a" | "all" => chosen.extend(choices.iter().filter(|c| c.available).map(|c| c.agent)),
            number => {
                let index = number
                    .parse::<usize>()
                    .ok()
                    .filter(|n| (1..=choices.len()).contains(n))
                    .ok_or_else(|| format!("\"{word}\" is not one of the numbers above."))?;
                let choice = &choices[index - 1];
                if !choice.available {
                    return Err(format!(
                        "{} is not available: {}",
                        choice.agent.label(),
                        choice.detail
                    ));
                }
                chosen.push(choice.agent);
            }
        }
    }
    chosen.sort();
    chosen.dedup();
    if chosen.is_empty() {
        return Err("Choose at least one agent, or q to cancel.".into());
    }
    Ok(Some(chosen))
}
