//! The reminder rules of the Stop hook. Add a rule by adding an entry to
//! [`RULES`].

use super::{Call, Ctx};

/// How sure the hook is about an item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    /// A fact the hook verified that is a violation.
    Definite,
    /// A trigger fired; the agent decides whether it applies.
    Check,
}

/// One line of the checklist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Item {
    pub kind: Kind,
    pub text: String,
}

impl Item {
    fn definite(text: impl Into<String>) -> Item {
        Item {
            kind: Kind::Definite,
            text: text.into(),
        }
    }
    fn check(text: impl Into<String>) -> Item {
        Item {
            kind: Kind::Check,
            text: text.into(),
        }
    }
}

/// One rule: it gives the checklist items that apply to this turn, none when
/// it does not trigger.
pub(crate) struct Rule {
    /// The rule's name, for tests and logs.
    #[allow(dead_code)]
    pub id: &'static str,
    pub check: fn(&Ctx) -> Vec<Item>,
}

/// Every rule, in the order their items are listed.
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

/// The last reply is a question to the user and none was put on the board.
fn question(ctx: &Ctx) -> Vec<Item> {
    let Some(reply) = ctx.reply() else {
        return Vec::new();
    };
    // Without a readable transcript the turn cannot be checked.
    if !ends_with_question(reply)
        || ctx.turn.is_none()
        || ctx
            .calls()
            .iter()
            .any(|c| runs_agboard(&c.command, &[&["message", "ask"], &["message", "answer"]]))
    {
        return Vec::new();
    }
    vec![
        Item::check(
            "Does your question wait on the user's answer? If so, put it on the board with `agboard message ask` and show it in the chat too.",
        ),
        Item::check(
            "Does it ask about something visual (a screen, a mock, a design)? Attach the images to the question.",
        ),
    ]
}

/// Results the requester should see: a missing final result, or something
/// viewable produced without a recorded result.
fn result(ctx: &Ctx) -> Vec<Item> {
    let mut items = Vec::new();
    if let Some(progress) = ctx.progress() {
        for task in &progress.final_result_missing {
            items.push(Item::definite(format!(
                "Task #{id} has all conditions met but no final result: record `agboard result add {id} --final ...`.",
                id = task.id
            )));
        }
    }
    let calls = ctx.calls();
    let recorded = calls
        .iter()
        .any(|c| runs_agboard(&c.command, &[&["result", "add"]]));
    let mut from_turn = false;
    if !recorded && has_running_ai_task(ctx) {
        if calls.iter().any(is_pr_create) {
            items.push(Item::definite(
                "You opened a pull request in this turn but recorded no result.",
            ));
            from_turn = true;
        } else if calls.iter().any(produced_viewable) {
            items.push(Item::check("You pushed or produced an image. If it is something the requester can look at, record it with `agboard result add`."));
            from_turn = true;
        }
    }
    if from_turn {
        items.push(Item::check("Record meaningful progress (commits, verification, decisions) with `agboard history add` if you have not."));
    }
    items
}

fn is_pr_create(call: &Call) -> bool {
    contains_sequence(&tokens(&call.command), &["gh", "pr", "create"])
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
