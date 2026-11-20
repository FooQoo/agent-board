//! Cases of the record and start rules: `history`, `conditions-after-merge`,
//! and `start-task`.

use super::cases::Case;
use super::test_support::{Scenario, call, progress_with, write_call};

fn case(rule: &'static str, name: &'static str, triggers: bool, scenario: Scenario) -> Case {
    Case {
        rule,
        name,
        triggers,
        scenario,
    }
}

fn running(calls: Vec<super::Call>) -> Scenario {
    Scenario::turn("Done.", calls, Some(progress_with(true, &[])))
}

fn idle(calls: Vec<super::Call>) -> Scenario {
    Scenario::turn("Done.", calls, Some(progress_with(false, &[])))
}

fn codex_patch(path: &str) -> super::Call {
    super::Call {
        name: "apply_patch".into(),
        command: format!("*** Begin Patch\n*** Update File: {path}\n@@\n-a\n+b\n*** End Patch"),
        path: String::new(),
    }
}

/// A merge over a running task whose conditions are `done` of 2.
fn merge_with(done: usize) -> Scenario {
    let mut scenario = running(vec![call("gh pr merge 5 --merge")]);
    if let Some(progress) = scenario.progress.as_mut() {
        for task in progress
            .epics
            .iter_mut()
            .flat_map(|e| e.tasks.iter_mut())
            .chain(progress.unassigned.iter_mut())
        {
            task.acceptance.total = 2;
            task.acceptance.done = done;
        }
    }
    scenario
}

pub fn all() -> Vec<Case> {
    let mut cases = Vec::new();
    cases.extend([
        case(
            "history",
            "a commit and nothing recorded",
            true,
            running(vec![call("git commit -m 'feat: x'")]),
        ),
        case(
            "history",
            "tests run with cargo",
            true,
            running(vec![call("TZ=UTC cargo test --all")]),
        ),
        case(
            "history",
            "tests run with pnpm",
            true,
            running(vec![call("pnpm --dir web test:e2e")]),
        ),
        case(
            "history",
            "tests run with playwright",
            true,
            running(vec![call("npx playwright test")]),
        ),
        case(
            "history",
            "a pull request opened",
            true,
            running(vec![call("gh pr create --title x --body y")]),
        ),
        case(
            "history",
            "a commit with a history note",
            false,
            running(vec![
                call("git commit -m x"),
                call("agboard history add 5 --message m --actor ai"),
            ]),
        ),
        case(
            "history",
            "a commit with a state change",
            false,
            running(vec![
                call("git commit -m x"),
                call("agboard state 5 idle --reason r --actor ai"),
            ]),
        ),
        case(
            "history",
            "a commit with a result",
            false,
            running(vec![
                call("git commit -m x"),
                call("agboard result add 5 --summary s --actor ai"),
            ]),
        ),
        case(
            "history",
            "a commit while no AI task runs",
            false,
            idle(vec![call("git commit -m x")]),
        ),
        case(
            "history",
            "a plain command",
            false,
            running(vec![call("ls"), call("git status")]),
        ),
    ]);
    cases.extend([
        case(
            "conditions-after-merge",
            "a merge while a Doing task has open conditions",
            true,
            merge_with(1),
        ),
        case(
            "conditions-after-merge",
            "a merge with all conditions done",
            false,
            merge_with(2),
        ),
        case(
            "conditions-after-merge",
            "no merge",
            false,
            running(vec![call("gh pr view 5")]),
        ),
        case(
            "conditions-after-merge",
            "a merge while no task is in Doing",
            false,
            idle(vec![call("gh pr merge 5 --merge")]),
        ),
    ]);
    cases.extend([
        case(
            "start-task",
            "an Edit with no task running",
            true,
            idle(vec![write_call("/repo/src/main.rs")]),
        ),
        case(
            "start-task",
            "a Codex patch with no task running",
            true,
            idle(vec![codex_patch("src/lib.rs")]),
        ),
        case(
            "start-task",
            "a commit with no task running",
            true,
            idle(vec![call("git commit -m x")]),
        ),
        case(
            "start-task",
            "edits while a task runs",
            false,
            running(vec![write_call("/repo/src/main.rs")]),
        ),
        case(
            "start-task",
            "an edit under /tmp",
            false,
            idle(vec![write_call("/tmp/scratch.txt")]),
        ),
        case(
            "start-task",
            "a Codex patch of the data folder",
            false,
            idle(vec![codex_patch("/Users/me/.agent-board/shared/x.md")]),
        ),
        case(
            "start-task",
            "no edit at all",
            false,
            idle(vec![call("cargo test")]),
        ),
        case(
            "start-task",
            "no progress table",
            false,
            Scenario::turn("Done.", vec![write_call("/repo/a.rs")], None),
        ),
    ]);
    cases
}
