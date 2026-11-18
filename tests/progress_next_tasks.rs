//! `nextTasks` of the progress table: the ready AI tasks to pick up next. Runs the
//! real CLI on a temporary data area.

use std::fs;
use std::path::Path;

use assert_cmd::Command;
use serde_json::Value;
use tempfile::{TempDir, tempdir};

fn agboard(home: &Path, args: &[&str]) -> Value {
    let mut full = vec!["--project", "Demo"];
    full.extend(args);
    let assert = Command::cargo_bin("agboard")
        .unwrap()
        .env("AGBOARD_AUTOSTART", "0")
        .env("AGBOARD_OPEN_BROWSER", "0")
        .env("AGBOARD_WATCH", "poll")
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .current_dir(home)
        .args(full)
        .assert()
        .success();
    let stdout = String::from_utf8(assert.get_output().stdout.clone()).unwrap();
    serde_json::from_str(&stdout).unwrap_or(Value::Null)
}

fn board(epics: &[&str]) -> TempDir {
    let home = tempdir().unwrap();
    let folder = home.path().join("work");
    fs::create_dir_all(&folder).unwrap();
    Command::cargo_bin("agboard")
        .unwrap()
        .env("AGBOARD_AUTOSTART", "0")
        .env("AGBOARD_OPEN_BROWSER", "0")
        .env("AGBOARD_WATCH", "poll")
        .env("AGBOARD_HOME", home.path())
        .args([
            "project",
            "create",
            "Demo",
            "--folder",
            &folder.display().to_string(),
        ])
        .assert()
        .success();
    for epic in epics {
        agboard(
            home.path(),
            &["epic", "add", epic, "--name", epic, "--actor", "ai"],
        );
    }
    home
}

fn add(home: &Path, epic: Option<&str>, assignee: &str, actor: &str) -> i64 {
    let mut args = vec![
        "add",
        "task",
        "--assignee",
        assignee,
        "--actor",
        actor,
        "--json",
    ];
    if let Some(epic) = epic {
        args.extend(["--epic", epic]);
    }
    agboard(home, &args)["task"]["id"].as_i64().unwrap()
}

fn ready(home: &Path, epic: Option<&str>) -> i64 {
    add(home, epic, "ai", "human")
}

fn doing(home: &Path, id: i64) {
    agboard(
        home,
        &[
            "mv",
            &id.to_string(),
            "doing",
            "--actor",
            "ai",
            "--reason",
            "go",
        ],
    );
}

fn running(home: &Path, id: i64) {
    agboard(
        home,
        &[
            "state",
            &id.to_string(),
            "running",
            "--actor",
            "ai",
            "--reason",
            "go",
        ],
    );
}

fn next(home: &Path) -> Vec<(i64, String)> {
    let table = agboard(home, &["progress", "--json"]);
    table["nextTasks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|task| {
            (
                task["id"].as_i64().unwrap(),
                task["why"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

#[test]
fn an_empty_board_has_an_empty_list() {
    let home = board(&[]);
    let table = agboard(home.path(), &["progress", "--json"]);
    assert_eq!(table["nextTasks"], serde_json::json!([]));
}

#[test]
fn resume_comes_before_todo_and_epics_keep_the_table_order() {
    let home = board(&["ALPHA", "BETA"]);
    let alpha_todo = ready(home.path(), Some("ALPHA"));
    let beta_todo = ready(home.path(), Some("BETA"));
    let beta_doing = ready(home.path(), Some("BETA"));
    let loose_todo = ready(home.path(), None);
    doing(home.path(), beta_doing);
    assert_eq!(
        next(home.path()),
        vec![
            (beta_doing, "resume".to_string()),
            (alpha_todo, "next_in_epic".to_string()),
            (beta_todo, "next_in_epic".to_string()),
        ]
    );
    let _ = loose_todo;
}

#[test]
fn todo_follows_the_epic_priority_and_unassigned_comes_last() {
    let home = board(&["ALPHA"]);
    let first = ready(home.path(), Some("ALPHA"));
    let second = ready(home.path(), Some("ALPHA"));
    let loose = ready(home.path(), None);
    agboard(
        home.path(),
        &[
            "epic",
            "edit",
            "ALPHA",
            "--priority",
            &format!("{second},{first}"),
        ],
    );
    let ids: Vec<i64> = next(home.path()).into_iter().map(|(id, _)| id).collect();
    assert_eq!(ids, vec![second, first, loose]);
    let table = agboard(home.path(), &["progress", "--json"]);
    assert_eq!(table["nextTasks"][0]["epicId"], "ALPHA");
    assert_eq!(table["nextTasks"][2]["epicId"], Value::Null);
    assert!(
        table["nextTasks"][0]["taskPath"]
            .as_str()
            .unwrap()
            .ends_with(&format!("tasks/{second}/TASK.md"))
    );
}

#[test]
fn running_human_owned_and_draft_tasks_are_left_out() {
    let home = board(&["ALPHA"]);
    let run = ready(home.path(), Some("ALPHA"));
    doing(home.path(), run);
    running(home.path(), run);
    add(home.path(), Some("ALPHA"), "human", "human");
    add(home.path(), Some("ALPHA"), "ai", "ai");
    let candidate = ready(home.path(), Some("ALPHA"));
    assert_eq!(
        next(home.path()),
        vec![(candidate, "next_in_epic".to_string())]
    );
}

#[test]
fn at_most_three_are_listed() {
    let home = board(&["ALPHA"]);
    let ids: Vec<i64> = (0..5).map(|_| ready(home.path(), Some("ALPHA"))).collect();
    let listed: Vec<i64> = next(home.path()).into_iter().map(|(id, _)| id).collect();
    assert_eq!(listed, ids[..3].to_vec());
}
