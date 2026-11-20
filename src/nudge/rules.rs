//! The registry. Add a rule by adding an entry to [`RULES`] and a function it
//! points to, then its cases in `cases.rs` and a row in the rule list of
//! `docs/dev/concepts/agents.md` (and its Japanese copy).

use super::commands::{contains_sequence, ends_with_question, runs_agboard, tokens};
use super::state_rules;
use super::{Area, Call, Facts, Finding, Kind, Rule, Source, When};

/// Every rule, in the order their reminders are listed.
pub const RULES: &[Rule] = &[
    Rule {
        id: "question",
        area: Area::Question,
        source: Source::Turn,
        when: When::TurnEnd,
        kind: Kind::Check,
        check: question,
    },
    Rule {
        id: "final-result",
        area: Area::Record,
        source: Source::State,
        when: When::Both,
        kind: Kind::Definite,
        check: final_result,
    },
    Rule {
        id: "result-pr",
        area: Area::Record,
        source: Source::Turn,
        when: When::TurnEnd,
        kind: Kind::Definite,
        check: result_pr,
    },
    Rule {
        id: "result-artifact",
        area: Area::Record,
        source: Source::Turn,
        when: When::TurnEnd,
        kind: Kind::Check,
        check: result_artifact,
    },
    Rule {
        id: "result-history",
        area: Area::Record,
        source: Source::Turn,
        when: When::TurnEnd,
        kind: Kind::Check,
        check: result_history,
    },
    entry(
        "answer",
        Area::Question,
        Kind::Definite,
        state_rules::answer,
    ),
    entry(
        "request",
        Area::Question,
        Kind::Definite,
        state_rules::request,
    ),
    entry(
        "conditions",
        Area::Acceptance,
        Kind::Check,
        state_rules::conditions,
    ),
    entry(
        "epic-close",
        Area::Epic,
        Kind::Definite,
        state_rules::epic_close,
    ),
    entry(
        "stale-running",
        Area::RunState,
        Kind::Check,
        state_rules::stale_running,
    ),
    entry(
        "next-task",
        Area::RunState,
        Kind::Check,
        state_rules::next_task,
    ),
    entry(
        "draft-moved",
        Area::RunState,
        Kind::Definite,
        state_rules::draft_moved,
    ),
    entry("drafts", Area::RunState, Kind::Check, state_rules::drafts),
];

/// A `State` rule shown in the progress table and the Stop checklist.
const fn entry(
    id: &'static str,
    area: Area,
    kind: Kind,
    check: fn(&Facts) -> Vec<Finding>,
) -> Rule {
    Rule {
        id,
        area,
        source: Source::State,
        when: When::Both,
        kind,
        check,
    }
}

/// The last reply is a question to the user and none was put on the board.
fn question(facts: &Facts) -> Vec<Finding> {
    let Some(reply) = facts.reply() else {
        return Vec::new();
    };
    // Without a readable transcript the turn cannot be checked.
    if !ends_with_question(reply)
        || facts.turn.is_none()
        || facts
            .calls()
            .iter()
            .any(|c| runs_agboard(&c.command, &[&["message", "ask"], &["message", "answer"]]))
    {
        return Vec::new();
    }
    vec![
        Finding::new(
            "Does your question wait on the user's answer? If so, put it on the board with `agboard message ask` and show it in the chat too.",
        ),
        Finding::new(
            "Does it ask about something visual (a screen, a mock, a design)? Attach the images to the question.",
        ),
    ]
}

/// An AI task has all its conditions met and no final result.
fn final_result(facts: &Facts) -> Vec<Finding> {
    let Some(progress) = facts.progress else {
        return Vec::new();
    };
    progress
        .final_result_missing
        .iter()
        .map(|task| {
            Finding::new(format!(
                "Task #{id} has all conditions met but no final result: record `agboard result add {id} --final ...`.",
                id = task.id
            ))
            .task(task.id)
        })
        .collect()
}

/// The turn opened a pull request and recorded no result.
fn result_pr(facts: &Facts) -> Vec<Finding> {
    if !result_expected(facts) || !facts.calls().iter().any(is_pr_create) {
        return Vec::new();
    }
    vec![Finding::new(
        "You opened a pull request in this turn but recorded no result.",
    )]
}

/// The turn pushed or produced an image (and opened no pull request) and
/// recorded no result.
fn result_artifact(facts: &Facts) -> Vec<Finding> {
    let calls = facts.calls();
    if !result_expected(facts)
        || calls.iter().any(is_pr_create)
        || !calls.iter().any(produced_viewable)
    {
        return Vec::new();
    }
    vec![Finding::new(
        "You pushed or produced an image. If it is something the requester can look at, record it with `agboard result add`.",
    )]
}

/// Work that deserves a result also deserves a history note.
fn result_history(facts: &Facts) -> Vec<Finding> {
    if result_pr(facts).is_empty() && result_artifact(facts).is_empty() {
        return Vec::new();
    }
    vec![Finding::new(
        "Record meaningful progress (commits, verification, decisions) with `agboard history add` if you have not.",
    )]
}

/// A result is due: the turn recorded none while an AI task is running.
fn result_expected(facts: &Facts) -> bool {
    !facts
        .calls()
        .iter()
        .any(|c| runs_agboard(&c.command, &[&["result", "add"]]))
        && has_running_ai_task(facts)
}

fn is_pr_create(call: &Call) -> bool {
    contains_sequence(&tokens(&call.command), &["gh", "pr", "create"])
}

fn has_running_ai_task(facts: &Facts) -> bool {
    use crate::domain::{Assignee, Column, RunState};
    let Some(progress) = facts.progress else {
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
