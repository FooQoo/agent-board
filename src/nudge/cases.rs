//! The test cases of the rules: every rule in the registry needs at least one
//! case that triggers it and one that does not (`tests::every_rule_has_cases`).
//! Add your rule's cases here.

use super::test_support::{Scenario, call, progress_with, write_call};

/// One case: whether the rule gives a reminder for the scenario.
pub struct Case {
    pub rule: &'static str,
    pub name: &'static str,
    pub triggers: bool,
    pub scenario: Scenario,
}

pub(super) fn case(
    rule: &'static str,
    name: &'static str,
    triggers: bool,
    scenario: Scenario,
) -> Case {
    Case {
        rule,
        name,
        triggers,
        scenario,
    }
}

pub(super) const ASK: &str = "agboard message ask --actor ai --questions-json '{}'";
const PR: &str = "gh pr create --title x --body y";

fn running(message: &'static str, calls: Vec<super::Call>) -> Scenario {
    Scenario::turn(message, calls, Some(progress_with(true, &[])))
}

pub fn all() -> Vec<Case> {
    let mut cases = Vec::new();
    // question
    cases.extend([
        case(
            "question",
            "a question never put on the board",
            true,
            Scenario::turn("May I proceed?", vec![call("ls")], None),
        ),
        case(
            "question",
            "a question asked with message ask",
            false,
            Scenario::turn("May I proceed?", vec![call(ASK)], None),
        ),
        case(
            "question",
            "a reply that is not a question",
            false,
            Scenario::turn("All done.", vec![], None),
        ),
        case(
            "question",
            "no readable transcript",
            false,
            Scenario {
                message: Some("May I proceed?"),
                ..Scenario::default()
            },
        ),
    ]);
    // final-result
    cases.extend([
        case(
            "final-result",
            "a task with all conditions met and no final result",
            true,
            Scenario::state(progress_with(false, &[7])),
        ),
        case(
            "final-result",
            "no task lacks a final result",
            false,
            Scenario::state(progress_with(false, &[])),
        ),
    ]);
    // result-pr
    cases.extend([
        case(
            "result-pr",
            "a pull request and no result",
            true,
            running("Done.", vec![call(PR)]),
        ),
        case(
            "result-pr",
            "a pull request with a recorded result",
            false,
            running(
                "Done.",
                vec![
                    call(PR),
                    call("agboard result add 5 --summary s --actor ai"),
                ],
            ),
        ),
        case(
            "result-pr",
            "a pull request while no AI task runs",
            false,
            Scenario::turn("Done.", vec![call(PR)], Some(progress_with(false, &[]))),
        ),
    ]);
    // result-artifact
    cases.extend([
        case(
            "result-artifact",
            "a push",
            true,
            running("Done.", vec![call("git push -u origin feature/x")]),
        ),
        case(
            "result-artifact",
            "a screenshot command",
            true,
            running("Done.", vec![call("screencapture -x /tmp/shot.png")]),
        ),
        case(
            "result-artifact",
            "an image written by a tool",
            true,
            running("Done.", vec![write_call("/tmp/mock.PNG")]),
        ),
        case(
            "result-artifact",
            "reading an image and a plain command",
            false,
            running("Done.", vec![call("ls /tmp/shot.png"), call("cargo test")]),
        ),
        case(
            "result-artifact",
            "a push next to a pull request (the pull request rule covers it)",
            false,
            running(
                "Done.",
                vec![call(PR), call("git push -u origin feature/x")],
            ),
        ),
    ]);
    // result-history
    cases.extend([
        case(
            "result-history",
            "a pull request and no result",
            true,
            running("Done.", vec![call(PR)]),
        ),
        case(
            "result-history",
            "a push and no result",
            true,
            running("Done.", vec![call("git push")]),
        ),
        case(
            "result-history",
            "a plain command",
            false,
            running("Done.", vec![call("cargo test")]),
        ),
    ]);
    cases.extend(super::cases_question::all());
    cases
}
