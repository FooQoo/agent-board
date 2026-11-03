//! Taking over Hooks that a person wrote by hand for this project, so that
//! connect converges instead of stopping. A hand-written Hook is taken over
//! only when it is the one connect installs: the same event and matcher, alone
//! in its group, and the fixed command, or the fixed command with `--project`
//! naming this project by its name or id. Anything else that mentions
//! `agboard` still stops the change.

use super::duplicates::Found;
use super::registry::ManagedHookEntry;

/// The bound project a hand-written Hook may name.
#[derive(Debug, Clone, Copy, Default)]
pub struct ThisProject<'a> {
    pub id: Option<&'a str>,
    pub name: Option<&'a str>,
}

impl ThisProject<'_> {
    /// Whether `found` is `entry` written by hand for this project.
    pub fn adopts(&self, found: &Found, entry: &ManagedHookEntry) -> bool {
        found.event == entry.event
            && found.matcher == entry.matcher
            && found.group_hooks == 1
            && self.same_command(&found.command, &entry.command)
    }

    fn same_command(&self, command: &str, fixed: &str) -> bool {
        let Some(words) = words(command) else {
            return false;
        };
        let fixed: Vec<&str> = fixed.split_whitespace().collect();
        if words == fixed {
            return true;
        }
        let (project, tail) = match words.as_slice() {
            [agboard, flag, value, tail @ ..] if agboard == "agboard" && flag == "--project" => {
                (value.as_str(), tail)
            }
            [agboard, flag, tail @ ..] if agboard == "agboard" => {
                match flag.strip_prefix("--project=") {
                    Some(value) => (value, tail),
                    None => return false,
                }
            }
            _ => return false,
        };
        fixed.first() == Some(&"agboard")
            && tail
                .iter()
                .map(String::as_str)
                .eq(fixed[1..].iter().copied())
            && (self.id == Some(project) || self.name == Some(project))
    }
}

/// The words of a command, with single and double quotes removed. `None`
/// when the command uses anything a plain word list cannot hold (an open
/// quote, a backslash, or shell syntax such as `;`, `|`, `&`, `$`, or a
/// backtick), so its meaning is left unconfirmed.
fn words(command: &str) -> Option<Vec<String>> {
    let mut words = Vec::new();
    let mut word: Option<String> = None;
    let mut quote: Option<char> = None;
    for c in command.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => word.get_or_insert_with(String::new).push(c),
            (None, '\'' | '"') => {
                quote = Some(c);
                word.get_or_insert_with(String::new);
            }
            (None, c) if c.is_whitespace() => words.extend(word.take()),
            (None, ';' | '|' | '&' | '$' | '`' | '\\' | '<' | '>' | '(' | ')') => return None,
            (None, c) => word.get_or_insert_with(String::new).push(c),
        }
    }
    if quote.is_some() {
        return None;
    }
    words.extend(word);
    Some(words)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(command: &str, group_hooks: usize) -> Found {
        Found {
            event: "SessionStart".into(),
            matcher: Some("startup".into()),
            command: command.into(),
            group_index: 0,
            group_hooks,
            group_sha: String::new(),
        }
    }

    fn entry() -> ManagedHookEntry {
        ManagedHookEntry {
            event: "SessionStart".into(),
            matcher: Some("startup".into()),
            command: "agboard hook --agent codex".into(),
            sha256: String::new(),
        }
    }

    const THIS: ThisProject = ThisProject {
        id: Some("ef18"),
        name: Some("My project"),
    };

    #[test]
    fn the_fixed_command_and_this_projects_name_or_id_are_taken_over() {
        for command in [
            "agboard hook --agent codex",
            "agboard  hook   --agent codex",
            "agboard --project 'My project' hook --agent codex",
            "agboard --project \"My project\" hook --agent codex",
            "agboard --project=ef18 hook --agent codex",
        ] {
            assert!(THIS.adopts(&found(command, 1), &entry()), "{command}");
        }
    }

    #[test]
    fn another_project_another_agent_or_more_words_stay_unconfirmed() {
        for command in [
            "agboard --project other hook --agent codex",
            "agboard --project 'My project' hook --agent claude",
            "agboard hook --agent codex --verbose",
            "agboard hook --agent codex; rm -rf ~",
            "agboard --project 'My project hook --agent codex",
            "AGBOARD_HOME=/x agboard hook --agent codex",
        ] {
            assert!(!THIS.adopts(&found(command, 1), &entry()), "{command}");
        }
    }

    #[test]
    fn a_group_with_another_hook_or_another_matcher_is_not_taken_over() {
        assert!(!THIS.adopts(&found("agboard hook --agent codex", 2), &entry()));
        let mut other = found("agboard hook --agent codex", 1);
        other.matcher = None;
        assert!(!THIS.adopts(&other, &entry()));
    }
}
