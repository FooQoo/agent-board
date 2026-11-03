//! Answers the cliclack prompts of connect and update on a pseudo-terminal
//! with keys, as a person would.

use expectrl::session::OsSession as Session;
use expectrl::{Expect, Regex};

/// The final question of connect.
pub const CONFIRM: &str = "Apply these changes?";
pub const ENTER: &str = "\r";
pub const CTRL_C: &str = "\u{3}";

/// Waits for `prompt` and answers it with keys, as a person would:
/// - "Select agents": the numbers of the listed agents to end up chosen
///   ("1 2"), "" to keep what is offered, or "q" to cancel.
/// - a scope: "1" Global, "2" Project, "" the offered one, or "q".
/// - [`CONFIRM`]: "y", "n", or "" (the default no).
///
/// Returns what was shown up to the answer.
pub fn answer(term: &mut Session, prompt: &str, reply: &str, so_far: &str) -> String {
    let seen = term
        .expect(prompt)
        .unwrap_or_else(|e| panic!("prompt {prompt:?} not shown ({e}); screen so far:\n{so_far}"));
    let mut shown = String::from_utf8_lossy(seen.as_bytes()).into_owned();
    // The question block ends with its corner; keys sent before it is drawn
    // could arrive before the prompt reads the keyboard.
    let block = term.expect(Regex("(?s).*?└")).unwrap();
    let block = String::from_utf8_lossy(block.as_bytes()).into_owned();
    shown.push_str(&block);
    let keys = match (prompt, reply) {
        (_, "q") => CTRL_C.to_string(),
        (_, "") => ENTER.to_string(),
        ("Select agents", wanted) => toggles(&block, wanted),
        (_, "1") => format!("k{ENTER}"),
        (_, "2") => format!("j{ENTER}"),
        (_, other) => other.to_string(),
    };
    term.send(keys).unwrap();
    shown
}

/// The keys that turn the shown checkboxes into the `wanted` numbers, then
/// Enter. The cursor starts on the first agent.
fn toggles(list: &str, wanted: &str) -> String {
    let checked: Vec<bool> = list
        .lines()
        .filter_map(|line| {
            if line.contains('◼') {
                Some(true)
            } else if line.contains('◻') {
                Some(false)
            } else {
                None
            }
        })
        .collect();
    let wanted: Vec<usize> = wanted
        .split_whitespace()
        .map(|n| n.parse::<usize>().unwrap() - 1)
        .collect();
    let mut keys = String::new();
    for (i, on) in checked.iter().enumerate() {
        if i > 0 {
            keys.push('j');
        }
        if *on != wanted.contains(&i) {
            keys.push(' ');
        }
    }
    keys.push_str(ENTER);
    keys
}
