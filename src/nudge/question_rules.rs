//! Turn rules about questions put on the board with `message ask`: images,
//! the copy in the chat, and waiting for the answer.

use super::commands::{runs_agboard, tokens};
use super::rules::produced_image;
use super::{Call, Facts, Finding};

fn is_ask(call: &Call) -> bool {
    runs_agboard(&call.command, &[&["message", "ask"]])
}

/// A real ask: not a call that only prints the help text.
fn is_real_ask(call: &Call) -> bool {
    is_ask(call)
        && !tokens(&call.command)
            .iter()
            .any(|t| matches!(*t, "--help" | "-h"))
}

/// The ask carries an image: an `images` field or an `attachment:` reference.
fn carries_image(call: &Call) -> bool {
    let lower = call.command.to_ascii_lowercase();
    lower.contains("images\"") || lower.contains("attachment:")
}

/// The turn produced an image and asked a question that carries none.
pub fn question_images(facts: &Facts) -> Vec<Finding> {
    let calls = facts.calls();
    if !calls.iter().any(is_real_ask)
        || !calls.iter().any(produced_image)
        || calls
            .iter()
            .any(|c| carries_image(c) || runs_agboard(&c.command, &[&["attachment", "add"]]))
    {
        return Vec::new();
    }
    vec![Finding::new(
        "You produced an image and asked a question with no image. If the question is about something visual, attach the images (`agboard attachment add`, then `images` or `![](attachment:<id>)`).",
    )]
}

/// The turn asked a question on the board and the reply never shows its Q-id.
pub fn question_in_chat(facts: &Facts) -> Vec<Finding> {
    let Some(reply) = facts.reply() else {
        return Vec::new();
    };
    if !facts.calls().iter().any(is_real_ask) || mentions_question_id(reply) {
        return Vec::new();
    }
    vec![Finding::new(
        "You asked a question on the board but the reply shows no Q-id. Show the question with its Q-id in the chat too.",
    )]
}

/// The turn asked with `--no-wait` and never waited for the answer.
pub fn question_wait(facts: &Facts) -> Vec<Finding> {
    let calls = facts.calls();
    let Some(last_ask) = calls
        .iter()
        .rposition(|c| is_real_ask(c) && tokens(&c.command).contains(&"--no-wait"))
    else {
        return Vec::new();
    };
    if calls[last_ask..]
        .iter()
        .any(|c| runs_agboard(&c.command, &[&["message", "wait"]]))
    {
        return Vec::new();
    }
    vec![Finding::new(
        "You asked with `--no-wait` and never waited. Wait for the answer with `agboard message wait <Q-id>` in the background, or explain why you do not.",
    )]
}

/// Whether `text` holds a `Q-<n>` reference.
fn mentions_question_id(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.windows(3).enumerate().any(|(i, w)| {
        w[0] == b'Q'
            && w[1] == b'-'
            && w[2].is_ascii_digit()
            && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric())
    })
}
