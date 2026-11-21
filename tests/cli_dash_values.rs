//! Text options never take the next flag as their value, and text that starts with `-` has
//! explicit ways in: `--opt=- text`, a file, or `-` for standard input.

mod common;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use common::{agboard, demo_project};

/// The text of every `TASK.md` under `home`, joined.
fn all_task_text(home: &Path) -> String {
    fn walk(dir: &Path, out: &mut String) {
        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let path: PathBuf = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.file_name().is_some_and(|n| n == "TASK.md") {
                out.push_str(&std::fs::read_to_string(&path).unwrap());
            }
        }
    }
    let mut out = String::new();
    walk(home, &mut out);
    out
}

/// Run `agboard` with `input` on standard input.
fn agboard_stdin(home: &Path, args: &[&str], input: &str) -> (i32, String, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_AUTOSTART", "0")
        .env("AGBOARD_OPEN_BROWSER", "0")
        .env("AGBOARD_WATCH", "poll")
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .current_dir(home)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    (
        output.status.code().unwrap(),
        String::from_utf8(output.stdout).unwrap(),
        String::from_utf8(output.stderr).unwrap(),
    )
}

#[test]
fn a_text_option_without_its_value_fails_instead_of_taking_the_next_flag() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let before = all_task_text(home.path());
    let cases: &[&[&str]] = &[
        &["history", "add", "1", "--reason", "--json"],
        &["mv", "1", "todo", "--actor", "ai", "--reason", "--json"],
        &[
            "state", "1", "running", "--actor", "ai", "--reason", "--json",
        ],
        &["message", "send", "--actor", "human", "--text", "--json"],
        &[
            "message", "answer", "Q-1", "--actor", "human", "--via", "cli", "--text", "--json",
        ],
        &[
            "message",
            "ask",
            "--actor",
            "ai",
            "--questions-json",
            "--json",
        ],
        &["result", "add", "1", "--actor", "ai", "--summary", "--json"],
        &[
            "result",
            "add",
            "1",
            "--actor",
            "ai",
            "--summary",
            "ok",
            "--title",
            "--json",
        ],
        &[
            "result",
            "add",
            "1",
            "--actor",
            "ai",
            "--summary",
            "ok",
            "--link",
            "--json",
        ],
        &[
            "add",
            "New",
            "--assignee",
            "ai",
            "--actor",
            "human",
            "--desc",
            "--json",
        ],
        &["epic", "edit", "BUG", "--document", "--json"],
    ];
    for case in cases {
        let mut args = vec!["--project", "Demo"];
        args.extend_from_slice(case);
        let (code, out, err) = agboard(home.path(), &args);
        assert_eq!(code, 2, "{case:?} should be refused: {out}{err}");
        assert!(out.is_empty(), "{case:?} printed {out}");
        assert!(err.contains("invalid_argument"), "{case:?}: {err}");
        assert!(err.contains("a value is required"), "{case:?}: {err}");
    }
    assert_eq!(all_task_text(home.path()), before, "nothing was recorded");
}

#[test]
fn a_reason_with_a_leading_dash_is_recorded_with_equals_a_file_or_stdin() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());

    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "history",
            "add",
            "1",
            "--reason=- equals form",
        ],
    );
    assert_eq!(code, 0, "{err}");

    let file = home.path().join("reason.txt");
    std::fs::write(&file, "- file form\n").unwrap();
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "history",
            "add",
            "1",
            "--reason-file",
            file.to_str().unwrap(),
        ],
    );
    assert_eq!(code, 0, "{err}");

    let (code, _, err) = agboard_stdin(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "1",
            "todo",
            "--actor",
            "ai",
            "--reason",
            "-",
        ],
        "- stdin form\n",
    );
    assert_eq!(code, 0, "{err}");

    let text = all_task_text(home.path());
    for expected in ["- equals form", "- file form", "- stdin form"] {
        assert!(text.contains(expected), "missing {expected:?} in {text}");
    }
}

#[test]
fn a_spaced_dash_value_is_refused_with_a_hint_to_use_equals() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "history",
            "add",
            "1",
            "--reason",
            "- item",
        ],
    );
    assert_eq!(code, 2);
    assert!(err.contains("--reason=\"...\""), "{err}");
    assert!(!all_task_text(home.path()).contains("- item"));
}

#[test]
fn a_lone_dash_still_reads_the_description_from_standard_input() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, _, err) = agboard_stdin(
        home.path(),
        &[
            "--project",
            "Demo",
            "add",
            "From stdin",
            "--assignee",
            "ai",
            "--actor",
            "human",
            "--desc",
            "-",
        ],
        "Details from stdin\n",
    );
    assert_eq!(code, 0, "{err}");
    assert!(all_task_text(home.path()).contains("Details from stdin"));
}
