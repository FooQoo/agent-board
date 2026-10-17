//! The acceptance conditions in the CLI: an agent cannot move a task to Done
//! while a condition is unmet, and a person or a task with no conditions can.

mod common;

use common::{agboard, demo_project, json_error, json_ok};

/// Run a command that must succeed; its text output is not parsed.
fn run_ok(home: &std::path::Path, args: &[&str]) {
    let (code, _, err) = agboard(home, args);
    assert_eq!(code, 0, "{args:?} failed: {err}");
}

const UNMET: &str = "---\nacceptance:\n  - id: AC-1\n    text: The list is returned as JSON\n    done: true\n  - id: AC-2\n    text: Deletion asks for confirmation\n    done: false\n---\n\nBody.\n";
const ALL_MET: &str = "---\nacceptance:\n  - id: AC-1\n    text: The list is returned as JSON\n    done: true\n---\n\nBody.\n";
const DEFECT: &str = "---\nacceptance:\n  - id: AC-1\n    text: No done key\n---\n\nBody.\n";

fn write(home: &std::path::Path, name: &str, text: &str) -> std::path::PathBuf {
    let path = home.join(name);
    std::fs::write(&path, text).unwrap();
    path
}

fn add_task(home: &std::path::Path, desc: &str) {
    let file = write(home, "desc.md", desc);
    let file = file.to_str().unwrap();
    let (code, _, err) = agboard(
        home,
        &[
            "--project",
            "Demo",
            "add",
            "Task",
            "--assignee",
            "ai",
            "--actor",
            "ai",
            "--desc-file",
            file,
        ],
    );
    assert_eq!(code, 0, "{err}");
}

fn task_status(home: &std::path::Path, id: &str) -> String {
    json_ok(home, &["--project", "Demo", "show", id, "--json"])["task"]["taskStatus"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn an_agent_cannot_move_a_task_to_done_while_a_condition_is_unmet() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    add_task(home.path(), UNMET);

    let (code, error) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "2",
            "done",
            "--actor",
            "ai",
            "--reason",
            "Finished.",
        ],
    );
    assert_eq!(code, 2);
    assert_eq!(error, "acceptance_unmet");
    assert_eq!(
        task_status(home.path(), "2"),
        "todo",
        "a refused move changes nothing"
    );
}

#[test]
fn the_refusal_names_the_unmet_conditions() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    add_task(home.path(), UNMET);
    let (_, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "2",
            "done",
            "--actor",
            "ai",
            "--reason",
            "Finished.",
        ],
    );
    assert!(err.contains("AC-2"), "{err}");
    assert!(!err.contains("AC-1"), "{err}");
}

#[test]
fn an_agent_can_move_a_task_to_done_when_every_condition_is_met() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    add_task(home.path(), ALL_MET);
    run_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "2",
            "done",
            "--actor",
            "ai",
            "--reason",
            "Verified.",
        ],
    );
    assert_eq!(task_status(home.path(), "2"), "done");
}

#[test]
fn a_task_without_conditions_can_be_moved_to_done_by_an_agent() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    run_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "1",
            "done",
            "--actor",
            "ai",
            "--reason",
            "Nothing to check.",
        ],
    );
    assert_eq!(task_status(home.path(), "1"), "done");
}

#[test]
fn a_person_can_move_a_task_to_done_while_a_condition_is_unmet() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    add_task(home.path(), UNMET);
    run_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "2",
            "done",
            "--actor",
            "human",
            "--reason",
            "Dropped the second condition.",
        ],
    );
    assert_eq!(task_status(home.path(), "2"), "done");
}

#[test]
fn an_agent_is_refused_when_the_frontmatter_has_a_defect() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    add_task(home.path(), ALL_MET);
    // The CLI refuses a defective file when it is written, so the defect is put in by hand.
    let project = json_ok(home.path(), &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let file = home
        .path()
        .join("shared/projects")
        .join(project)
        .join("tasks/2/TASK.md");
    let valid = std::fs::read_to_string(&file).unwrap();
    let (_, history) = valid.split_once("history:").unwrap();
    let defective = DEFECT.replace("---\n\nBody.\n", &format!("history:{history}"));
    std::fs::write(&file, defective).unwrap();
    let (code, error) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "2",
            "done",
            "--actor",
            "ai",
            "--reason",
            "Finished.",
        ],
    );
    assert_eq!(code, 1);
    assert_eq!(error, "file_invalid");
    assert_eq!(task_status(home.path(), "2"), "todo");
}

#[test]
fn the_edit_help_says_that_a_file_is_replaced_with_its_frontmatter() {
    let home = tempfile::tempdir().unwrap();
    let (code, out, _) = agboard(home.path(), &["epic", "edit", "--help"]);
    assert_eq!(code, 0);
    assert!(out.contains("frontmatter"), "{out}");
}
