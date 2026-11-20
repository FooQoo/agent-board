//! Cases of the question rules in `question_rules.rs`.

use super::cases::{ASK, Case, case};
use super::test_support::{Scenario, call, write_call};

const ASK_NO_WAIT: &str = "agboard message ask --actor ai --no-wait --questions-json '{}'";
const ASK_IMAGE: &str =
    "agboard message ask --actor ai --questions-json '{\"images\":[\"att-1\"]}'";
const CODEX_ASK: &str =
    "{\"cmd\":\"agboard message ask --actor ai --no-wait --questions-json '{}'\"}";

fn turn(message: &'static str, calls: Vec<super::Call>) -> Scenario {
    Scenario::turn(message, calls, None)
}

pub fn all() -> Vec<Case> {
    let shot = || write_call("/tmp/mock.png");
    vec![
        case(
            "question-images",
            "an image and an ask without one",
            true,
            turn("Q-3 asked.", vec![shot(), call(ASK)]),
        ),
        case(
            "question-images",
            "an image and a Codex ask without one",
            true,
            turn(
                "Q-3 asked.",
                vec![call("screencapture -x /tmp/a.png"), call(CODEX_ASK)],
            ),
        ),
        case(
            "question-images",
            "an ask with an images field",
            false,
            turn("Q-3 asked.", vec![shot(), call(ASK_IMAGE)]),
        ),
        case(
            "question-images",
            "an attachment added in the turn",
            false,
            turn(
                "Q-3 asked.",
                vec![
                    shot(),
                    call("agboard attachment add --file /tmp/mock.png"),
                    call(ASK),
                ],
            ),
        ),
        case(
            "question-images",
            "an ask and no image",
            false,
            turn("Q-3 asked.", vec![call(ASK)]),
        ),
        case(
            "question-in-chat",
            "an ask and a reply with no Q-id",
            true,
            turn("I put a question on the board.", vec![call(ASK)]),
        ),
        case(
            "question-in-chat",
            "an ask and a reply with its Q-id",
            false,
            turn("Q-12: which option do you prefer?", vec![call(ASK)]),
        ),
        case(
            "question-in-chat",
            "a help call only",
            false,
            turn("Done.", vec![call("agboard message ask --help")]),
        ),
        case(
            "question-in-chat",
            "no readable transcript",
            false,
            Scenario {
                message: Some("Asked."),
                ..Scenario::default()
            },
        ),
        case(
            "question-wait",
            "--no-wait and no wait",
            true,
            turn("Q-3 asked.", vec![call(ASK_NO_WAIT)]),
        ),
        case(
            "question-wait",
            "--no-wait in a Codex call and no wait",
            true,
            turn("Q-3 asked.", vec![call(CODEX_ASK)]),
        ),
        case(
            "question-wait",
            "--no-wait followed by a wait",
            false,
            turn(
                "Q-3 asked.",
                vec![call(ASK_NO_WAIT), call("agboard message wait Q-3")],
            ),
        ),
        case(
            "question-wait",
            "an ask that waits",
            false,
            turn("Q-3 asked.", vec![call(ASK)]),
        ),
    ]
}
