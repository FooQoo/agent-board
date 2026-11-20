//! Turn rules about records and starting: history notes, acceptance
//! conditions after a merge, and starting a task before editing.

use super::commands::{contains_sequence, runs_agboard, tokens};
use super::rules::{has_running_ai_task, is_pr_create};
use super::{Call, Facts, Finding};
use crate::domain::{Assignee, Column};
use crate::progress::ProgressTask;

/// Commands that count as recording the turn on the board.
const RECORDS: &[&[&str]] = &[&["history", "add"], &["state"], &["mv"], &["result", "add"]];

/// A commit, a test run, a push, or a pull request while an AI task runs, and
/// nothing recorded on the board in the turn.
pub(super) fn history(facts: &Facts) -> Vec<Finding> {
    let calls = facts.calls();
    if !has_running_ai_task(facts)
        || calls.iter().any(|c| runs_agboard(&c.command, RECORDS))
        || !calls.iter().any(is_progress)
    {
        return Vec::new();
    }
    vec![Finding::new(
        "Record meaningful progress (commits, verification, decisions) with `agboard history add`: this turn made a commit, ran tests, pushed, or opened a pull request and recorded nothing.",
    )]
}

/// The turn merged a pull request while an AI task in Doing still has open
/// conditions.
pub(super) fn conditions_after_merge(facts: &Facts) -> Vec<Finding> {
    if !facts.calls().iter().any(is_merge) {
        return Vec::new();
    }
    open_doing_tasks(facts)
        .map(|task| {
            Finding::new(format!(
                "You merged a pull request while task #{id} has {open} of {total} conditions open: once the merge verified the work, record the verification in the task body and set its conditions done (the pull request is not linked to a task, so check which tasks it covers).",
                id = task.id,
                open = task.acceptance.total - task.acceptance.done,
                total = task.acceptance.total,
            ))
            .task(task.id)
        })
        .collect()
}

/// The turn edited files and no AI task is in Doing and Running.
pub(super) fn start_task(facts: &Facts) -> Vec<Finding> {
    // Without a progress table or a turn there is nothing to judge.
    if facts.progress.is_none()
        || facts.turn.is_none()
        || has_running_ai_task(facts)
        || !facts.calls().iter().any(edits_files)
    {
        return Vec::new();
    }
    vec![Finding::new(
        "You edited files but no AI task is in Doing and Running: start the task on the board (`agboard mv <id> doing`, `agboard state <id> running`) or create one.",
    )]
}

fn is_progress(call: &Call) -> bool {
    let tokens = tokens(&call.command);
    is_test_run(&tokens)
        || is_pr_create(call)
        || contains_sequence(&tokens, &["git", "commit"])
        || contains_sequence(&tokens, &["git", "push"])
}

fn is_merge(call: &Call) -> bool {
    contains_sequence(&tokens(&call.command), &["gh", "pr", "merge"])
}

fn open_doing_tasks<'a>(facts: &'a Facts) -> impl Iterator<Item = &'a ProgressTask> {
    facts.progress.into_iter().flat_map(|p| {
        p.epics
            .iter()
            .flat_map(|e| e.tasks.iter())
            .chain(p.unassigned.iter())
            .filter(|t| {
                t.assignee == Assignee::Ai
                    && t.draft.is_none()
                    && t.task_status == Column::Doing
                    && t.acceptance.done < t.acceptance.total
            })
    })
}

/// A test or verification command: `cargo test`, `npm test`, `pnpm ... test`,
/// `vitest`, `playwright test`, and the like.
fn is_test_run(tokens: &[&str]) -> bool {
    if tokens
        .iter()
        .any(|t| matches!(*t, "vitest" | "pytest" | "jest"))
    {
        return true;
    }
    if contains_sequence(tokens, &["cargo", "test"])
        || contains_sequence(tokens, &["cargo", "nextest"])
        || contains_sequence(tokens, &["playwright", "test"])
        || contains_sequence(tokens, &["go", "test"])
        || contains_sequence(tokens, &["make", "test"])
    {
        return true;
    }
    // A package manager: `test`, `test:e2e`, ... within a few tokens.
    tokens.iter().enumerate().any(|(i, t)| {
        matches!(*t, "npm" | "pnpm" | "yarn" | "bun")
            && tokens[i + 1..]
                .iter()
                .take(4)
                .any(|a| *a == "test" || a.starts_with("test:"))
    })
}

/// A call that edits a file outside `/tmp` and the Agent Board data folder, or
/// commits.
fn edits_files(call: &Call) -> bool {
    if contains_sequence(&tokens(&call.command), &["git", "commit"]) {
        return true;
    }
    if matches!(
        call.name.as_str(),
        "Edit" | "Write" | "MultiEdit" | "NotebookEdit"
    ) {
        return !call.path.is_empty() && !is_ignored_path(&call.path);
    }
    if call.name.ends_with("apply_patch") || call.command.contains("*** Begin Patch") {
        let paths: Vec<&str> = call
            .command
            .lines()
            .filter_map(|l| {
                let l = l.trim();
                ["*** Add File:", "*** Update File:", "*** Delete File:"]
                    .iter()
                    .find_map(|p| l.strip_prefix(p))
            })
            .map(str::trim)
            .collect();
        return paths.is_empty() || paths.iter().any(|p| !is_ignored_path(p));
    }
    false
}

fn is_ignored_path(path: &str) -> bool {
    let tmp = path == "/tmp" || path.starts_with("/tmp/");
    let data = path.contains("/.agent-board/") || path.ends_with("/.agent-board");
    let home = std::env::var("AGBOARD_HOME")
        .ok()
        .filter(|h| !h.is_empty())
        .is_some_and(|h| path.starts_with(h.trim_end_matches('/')));
    tmp || data || home
}
