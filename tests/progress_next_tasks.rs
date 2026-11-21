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
    if actor == "ai" {
        // A plan an agent makes waits in the Backlog.
        args.push("--backlog");
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
fn todo_follows_the_epic_waves_and_unassigned_comes_last() {
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
            "--waves",
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
fn running_human_owned_and_backlog_tasks_are_left_out() {
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

fn waves(home: &Path, values: &[&str]) {
    let mut args = vec!["epic", "edit", "ALPHA", "--waves"];
    args.extend(values);
    agboard(home, &args);
}

fn done(home: &Path, id: i64) {
    agboard(
        home,
        &[
            "mv",
            &id.to_string(),
            "done",
            "--actor",
            "human",
            "--reason",
            "ok",
        ],
    );
}

#[test]
fn a_wave_waits_for_the_waves_before_it_and_the_tasks_of_one_wave_are_listed_together() {
    let home = board(&["ALPHA"]);
    let first = ready(home.path(), Some("ALPHA"));
    let second = ready(home.path(), Some("ALPHA"));
    let third = ready(home.path(), Some("ALPHA"));
    let fourth = ready(home.path(), Some("ALPHA"));
    let (a, b, c, d) = (
        first.to_string(),
        second.to_string(),
        third.to_string(),
        fourth.to_string(),
    );
    waves(home.path(), &[&a, &format!("{b},{c}"), &d]);
    let ids = |home: &Path| -> Vec<i64> { next(home).into_iter().map(|(id, _)| id).collect() };

    assert_eq!(ids(home.path()), vec![first]);
    done(home.path(), first);
    assert_eq!(ids(home.path()), vec![second, third]);
    done(home.path(), second);
    // The wave is not finished while one of its tasks is open.
    assert_eq!(ids(home.path()), vec![third]);
    done(home.path(), third);
    assert_eq!(ids(home.path()), vec![fourth]);
}

#[test]
fn stalled_doing_work_is_resumed_even_when_its_wave_is_not_open_and_unlisted_tasks_are_not_gated() {
    let home = board(&["ALPHA"]);
    let first = ready(home.path(), Some("ALPHA"));
    let second = ready(home.path(), Some("ALPHA"));
    let unlisted = ready(home.path(), Some("ALPHA"));
    waves(home.path(), &[&first.to_string(), &second.to_string()]);
    doing(home.path(), second);
    assert_eq!(
        next(home.path()),
        vec![
            (second, "resume".to_string()),
            (first, "next_in_epic".to_string()),
            (unlisted, "next_in_epic".to_string()),
        ]
    );
}

#[test]
fn saving_waves_leaves_no_empty_wave_and_drops_tasks_that_are_not_members() {
    let home = board(&["ALPHA"]);
    let first = ready(home.path(), Some("ALPHA"));
    let second = ready(home.path(), Some("ALPHA"));
    let outsider = ready(home.path(), None);
    let (a, b, o) = (first.to_string(), second.to_string(), outsider.to_string());
    // A wave of non-members empties and goes away; so do blank values.
    let ghost = (outsider + 50).to_string();
    waves(home.path(), &[&o, &a, "", &format!("{b},{ghost}")]);
    let table = agboard(home.path(), &["progress", "--json"]);
    let path = table["epics"][0]["documentPath"].as_str().unwrap();
    let stored = fs::read_to_string(path).unwrap();
    assert!(stored.contains(&format!("- {first}\n")), "{stored}");
    assert!(stored.contains(&format!("- {second}\n")), "{stored}");
    assert!(!stored.contains(&o) && !stored.contains(&ghost), "{stored}");
    assert_eq!(table["epics"][0]["wavesError"], false);
    // Only the first wave can start, and the order survives a reload.
    let ids: Vec<i64> = next(home.path()).into_iter().map(|(id, _)| id).collect();
    assert_eq!(ids, vec![first, outsider]);
}
