use std::io::Cursor;

use skan::interact::confirm::{confirm, is_interactive};

/// Run `confirm` with the given input; return the answer and what was printed.
fn ask(input: &[u8]) -> (bool, String) {
    let mut reader = Cursor::new(input.to_vec());
    let mut output = Vec::new();
    let answer = confirm(
        "Delete #11 \"Implement card moves\"?",
        &mut reader,
        &mut output,
    )
    .unwrap();
    (answer, String::from_utf8(output).unwrap())
}

#[test]
fn yes_answers_return_true() {
    for input in [
        "y\n", "yes\n", "Y\n", "YES\n", "Yes\n", "y\r\n", "  y  \n", "y",
    ] {
        assert!(ask(input.as_bytes()).0, "{input:?} should confirm");
    }
}

#[test]
fn everything_else_returns_false() {
    for input in [
        "n\n",
        "\n",
        "",
        "yep\n",
        "no\n",
        "yes please\n",
        "yy\n",
        " \n",
    ] {
        assert!(!ask(input.as_bytes()).0, "{input:?} should cancel");
    }
}

#[test]
fn invalid_utf8_input_cancels() {
    assert!(!ask(&[0xff, 0xfe, b'\n']).0);
}

#[test]
fn prompt_is_followed_by_a_space_and_the_choice_marker() {
    let (_, printed) = ask(b"n\n");
    assert_eq!(printed, "Delete #11 \"Implement card moves\"? [y/N] ");
}

#[test]
fn only_the_first_line_is_consumed() {
    let mut reader = Cursor::new(b"n\ny\n".to_vec());
    let mut output = Vec::new();
    assert!(!confirm("Go?", &mut reader, &mut output).unwrap());
    let mut rest = String::new();
    std::io::BufRead::read_line(&mut reader, &mut rest).unwrap();
    assert_eq!(rest, "y\n");
}

#[test]
fn json_mode_is_never_interactive() {
    assert!(!is_interactive(true));
}
