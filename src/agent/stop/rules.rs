//! The reminder rules of the Stop hook. Add a rule by adding an entry to
//! [`RULES`].

use super::{Call, Ctx};

/// One reminder: it matches when `check` returns a message for the agent.
pub(crate) struct Rule {
    pub id: &'static str,
    pub check: fn(&Ctx) -> Option<String>,
}

/// Every rule, in the order their messages are listed.
pub(crate) const RULES: &[Rule] = &[
    Rule {
        id: "question",
        check: question,
    },
    Rule {
        id: "result",
        check: result,
    },
];

/// The last reply is a question to the user that was not put on the board.
fn question(ctx: &Ctx) -> Option<String> {
    if !ends_with_question(ctx.reply()?) {
        return None;
    }
    // Without a readable transcript the turn cannot be checked.
    ctx.turn.as_ref()?;
    if ctx
        .calls()
        .iter()
        .any(|c| runs_agboard(&c.command, &[&["message", "ask"], &["message", "answer"]]))
    {
        return None;
    }
    Some("Your reply ends with a question for the user, but it is not on the board. If it waits on the user's answer, put it on the board now with `agboard --project \"<name>\" message ask --actor ai ...` (and show it in the chat as plain text too, as the agent-board skill says). If nothing waits on the user, end your turn again without a question.".to_string())
}

/// Something viewable was produced and no result was recorded, or a task is
/// missing its final result.
fn result(ctx: &Ctx) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(progress) = ctx.progress() {
        let missing: Vec<String> = progress
            .final_result_missing
            .iter()
            .map(|t| format!("#{}", t.id))
            .collect();
        if !missing.is_empty() {
            parts.push(format!(
                "All conditions are met but there is no final result for task {}. Record it with `agboard result add <id> --final ...` (run `agboard skills results`).",
                missing.join(", ")
            ));
        }
    }
    let calls = ctx.calls();
    if calls.iter().any(produced_viewable)
        && !calls
            .iter()
            .any(|c| runs_agboard(&c.command, &[&["result", "add"]]))
        && has_running_ai_task(ctx)
    {
        parts.push("This turn produced something the requester can look at (a pull request, a push, or an image) but no result is recorded. Record it with `agboard result add <id> ...` on the running task (run `agboard skills results`), or end your turn again if nothing is viewable.".to_string());
    }
    (!parts.is_empty()).then(|| parts.join(" "))
}

fn has_running_ai_task(ctx: &Ctx) -> bool {
    use crate::domain::{Assignee, Column, RunState};
    let Some(progress) = ctx.progress() else {
        return false;
    };
    progress
        .epics
        .iter()
        .flat_map(|e| e.tasks.iter())
        .chain(progress.unassigned.iter())
        .any(|t| {
            t.assignee == Assignee::Ai
                && t.draft.is_none()
                && t.task_status == Column::Doing
                && t.agent_status == RunState::Running
        })
}

const IMAGE_EXTENSIONS: [&str; 5] = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

fn is_image(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    IMAGE_EXTENSIONS.iter().any(|e| lower.ends_with(e))
}

/// A call that opened a pull request, pushed, or wrote an image.
fn produced_viewable(call: &Call) -> bool {
    if is_image(&call.path) || call.name.ends_with("take_screenshot") {
        return true;
    }
    let tokens = tokens(&call.command);
    if contains_sequence(&tokens, &["gh", "pr", "create"])
        || contains_sequence(&tokens, &["git", "push"])
    {
        return true;
    }
    // A command that writes an image: it names an image file and a way to
    // produce one. Reading or listing one does not count.
    let lower = call.command.to_ascii_lowercase();
    tokens.iter().any(|t| is_image(t))
        && !runs_agboard(&call.command, &[&["result", "add"]])
        && [
            "screenshot",
            "screencapture",
            "capture",
            "--output",
            "--out",
            "--filename",
            "--path",
            " -o ",
            ">",
            "save",
            "convert",
            "magick",
            "ffmpeg",
        ]
        .iter()
        .any(|k| lower.contains(k))
}

/// Whether the last non-empty line of `text` ends with a question mark, once
/// closing markup and quotes are ignored.
pub(crate) fn ends_with_question(text: &str) -> bool {
    let Some(line) = text.lines().rev().map(str::trim).find(|l| !l.is_empty()) else {
        return false;
    };
    if line.starts_with("```") {
        return false;
    }
    let trimmed = line.trim_end_matches(|c: char| {
        c.is_whitespace()
            || matches!(
                c,
                '*' | '_'
                    | '`'
                    | '"'
                    | '\''
                    | ')'
                    | ']'
                    | '}'
                    | '」'
                    | '』'
                    | '）'
                    | '”'
                    | '’'
                    | '>'
            )
    });
    trimmed.ends_with('?') || trimmed.ends_with('？')
}

fn tokens(command: &str) -> Vec<&str> {
    command
        .split(|c: char| {
            c.is_whitespace()
                || matches!(
                    c,
                    '"' | '\'' | '\\' | ',' | '[' | ']' | '(' | ')' | ';' | '&' | '|'
                )
        })
        .filter(|t| !t.is_empty())
        .collect()
}

fn contains_sequence(tokens: &[&str], sequence: &[&str]) -> bool {
    tokens.windows(sequence.len()).any(|w| w == sequence)
}

/// Whether `command` runs `agboard` with any of the subcommand sequences,
/// global flags in between allowed.
pub(crate) fn runs_agboard(command: &str, sequences: &[&[&str]]) -> bool {
    let tokens = tokens(command);
    let Some(from) = tokens
        .iter()
        .position(|t| *t == "agboard" || t.ends_with("/agboard"))
    else {
        return false;
    };
    sequences
        .iter()
        .any(|s| contains_sequence(&tokens[from..], s))
}
