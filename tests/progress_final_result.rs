//! `finalResultMissing` of the progress table, and the late final result on a Done task.
//! Runs the real CLI on a temporary data area.

mod common;

use std::path::{Path, PathBuf};

use common::{demo_project, json_error, json_ok};
use serde_json::{Value, json};

const P: [&str; 2] = ["--project", "Demo"];

fn run(home: &Path, rest: &[&str]) -> Value {
    json_ok(home, &[&P[..], rest, &["--json"]].concat())
}

fn missing(home: &Path) -> Value {
    run(home, &["progress"])["finalResultMissing"].clone()
}

fn task_md(home: &Path) -> PathBuf {
    let table = run(home, &["progress"]);
    PathBuf::from(table["unassigned"][0]["taskPath"].as_str().unwrap())
}

/// Give task 1 conditions, all met or not.
fn set_conditions(home: &Path, all_done: bool) {
    let text = format!(
        "---\nacceptance:\n  - id: AC-1\n    text: One.\n    done: {all_done}\nhistory: []\n---\n\nBody\n"
    );
    std::fs::write(task_md(home), text).unwrap();
}

fn final_result(home: &Path) -> Value {
    run(
        home,
        &[
            "result",
            "add",
            "1",
            "--summary",
            "Shipped",
            "--final",
            "--actor",
            "ai",
        ],
    )
}

#[test]
fn the_field_is_absent_until_every_condition_is_met_and_clears_with_a_final_result() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    set_conditions(home.path(), false);
    assert_eq!(missing(home.path()), Value::Null);

    set_conditions(home.path(), true);
    let listed = missing(home.path());
    assert_eq!(listed[0]["id"], 1);
    assert_eq!(listed[0]["title"], "Implement sharing");
    assert!(listed[0]["taskPath"].as_str().unwrap().ends_with("TASK.md"));

    // A progress result does not clear it.
    run(
        home.path(),
        &["result", "add", "1", "--summary", "Half", "--actor", "ai"],
    );
    assert_ne!(missing(home.path()), Value::Null);

    final_result(home.path());
    assert_eq!(missing(home.path()), Value::Null);
}

#[test]
fn a_done_task_accepts_one_late_final_result_and_nothing_else() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    set_conditions(home.path(), true);
    run(
        home.path(),
        &["mv", "1", "done", "--actor", "ai", "--reason", "All met."],
    );
    // Done tasks leave the table but are still listed in the field.
    let table = run(home.path(), &["progress"]);
    assert_eq!(table["finalResultMissing"][0]["id"], 1);

    let (_, code) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "result",
            "add",
            "1",
            "--summary",
            "Late",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, "task_is_done");

    let recorded = final_result(home.path());
    assert_eq!(recorded["created"], true);
    assert_eq!(missing(home.path()), Value::Null);
    assert_eq!(
        run(home.path(), &["show", "1"])["task"]["taskStatus"],
        json!("done")
    );

    // A second, different final result is refused on the Done task.
    let (_, code) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "result",
            "add",
            "1",
            "--summary",
            "Again",
            "--final",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, "task_is_done");
}
