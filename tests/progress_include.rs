//! The optional progress sections: tasks waiting for a decision and recently
//! completed tasks. The default table must not change. Runs the real CLI on a
//! temporary data area.

use std::fs;
use std::io::Cursor;
use std::path::Path;

use assert_cmd::Command;
use serde_json::Value;
use tempfile::{TempDir, tempdir};

fn agboard(home: &Path, args: &[&str]) -> assert_cmd::assert::Assert {
    let mut full = vec!["--project", "Demo"];
    full.extend(args);
    Command::cargo_bin("agboard")
        .unwrap()
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .current_dir(home)
        .args(full)
        .assert()
}

fn out(assert: assert_cmd::assert::Assert) -> String {
    String::from_utf8(assert.success().get_output().stdout.clone()).unwrap()
}

fn json(assert: assert_cmd::assert::Assert) -> Value {
    serde_json::from_str(&out(assert)).unwrap()
}

fn add(home: &Path, title: &str, epic: Option<&str>) -> i64 {
    let mut args = vec!["add", title, "--assignee", "ai", "--actor", "ai", "--json"];
    if let Some(epic) = epic {
        args.extend(["--epic", epic]);
    }
    json(agboard(home, &args))["task"]["id"].as_i64().unwrap()
}

fn ids(list: &Value) -> Vec<i64> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|task| task["id"].as_i64().unwrap())
        .collect()
}

struct Board {
    home: TempDir,
    waiting: i64,
    first: i64,
    second: i64,
    open: i64,
}

fn board() -> Board {
    let home = tempdir().unwrap();
    let folder = home.path().join("work");
    fs::create_dir_all(&folder).unwrap();
    let folder = folder.display().to_string();
    Command::cargo_bin("agboard")
        .unwrap()
        .env("AGBOARD_HOME", home.path())
        .args(["project", "create", "Demo", "--folder", &folder])
        .assert()
        .success();
    for epic in ["ALPHA", "CLOSED"] {
        out(agboard(
            home.path(),
            &["epic", "add", epic, "--name", epic, "--actor", "ai"],
        ));
    }
    let waiting = add(home.path(), "waiting", Some("ALPHA"));
    let first = add(home.path(), "first done", Some("ALPHA"));
    let second = add(home.path(), "second done", Some("ALPHA"));
    let open = add(home.path(), "open", Some("ALPHA"));
    // Finished last, so they would come first if they were not left out:
    // an epic with no Todo or Doing task, and a task without an epic.
    let closed = add(home.path(), "closed epic done", Some("CLOSED"));
    let stray = add(home.path(), "no epic done", None);
    let w = waiting.to_string();
    out(agboard(
        home.path(),
        &["mv", &w, "doing", "--actor", "ai", "--reason", "start"],
    ));
    out(agboard(
        home.path(),
        &[
            "state",
            &w,
            "pending",
            "--actor",
            "ai",
            "--request-json",
            r#"{"question":"Proceed?","choices":[{"id":"y","label":"Yes"},{"id":"n","label":"No"}]}"#,
            "--no-wait",
        ],
    ));
    for id in [first, second, closed, stray] {
        out(agboard(
            home.path(),
            &[
                "mv",
                &id.to_string(),
                "done",
                "--actor",
                "human",
                "--reason",
                "done",
            ],
        ));
        // Completion times have one-second resolution.
        std::thread::sleep(std::time::Duration::from_millis(1100));
    }
    Board {
        home,
        waiting,
        first,
        second,
        open,
    }
}

#[test]
fn the_default_table_has_no_pending_or_done_sections() {
    let b = board();
    let table = json(agboard(b.home.path(), &["progress", "--json"]));
    assert!(table.get("pending").is_none());
    assert!(table.get("done").is_none());
    assert_eq!(ids(&table["epics"][0]["tasks"]), vec![b.open]);
    let text = out(agboard(b.home.path(), &["progress"]));
    assert!(!text.contains("Waiting for a decision"));
    assert!(!text.contains("Recently done"));
}

#[test]
fn include_flags_add_the_waiting_question_and_the_newest_done_tasks() {
    let b = board();
    let table = json(agboard(
        b.home.path(),
        &[
            "progress",
            "--include-pending",
            "--include-done",
            "1",
            "--json",
        ],
    ));
    assert_eq!(ids(&table["pending"]), vec![b.waiting]);
    assert_eq!(table["pending"][0]["question"], "Proceed?");
    assert_eq!(ids(&table["done"]), vec![b.second]);
    assert_eq!(ids(&table["epics"][0]["tasks"]), vec![b.open]);

    let text = out(agboard(
        b.home.path(),
        &["progress", "--include-pending", "--include-done", "2"],
    ));
    assert!(text.contains("Waiting for a decision"));
    assert!(text.contains("question: Proceed?"));
    assert!(text.contains("Recently done"));
    assert!(text.contains("first done"));
    assert!(text.find("second done") < text.find("first done"));
    assert!(!text.contains("closed epic done"));
    assert!(!text.contains("no epic done"));
    assert_eq!(ids(&table["done"]).len(), 1);
    let _ = b.first;
}

#[test]
fn the_hook_passes_the_flags_through() {
    let b = board();
    let input = br#"{"hook_event_name":"SessionStart"}"#;
    let default = agent_board::agent::hook::run(
        "claude",
        &mut Cursor::new(input),
        &b.home.path().join("shared"),
        Some("Demo"),
    )
    .unwrap();
    assert!(!default.contains("Proceed?"));
    let with = agent_board::agent::hook::run_with(
        "claude",
        &mut Cursor::new(input),
        &b.home.path().join("shared"),
        Some("Demo"),
        agent_board::progress::Include {
            pending: true,
            done: 1,
        },
    )
    .unwrap();
    assert!(with.contains("Proceed?"));
    assert!(with.contains("second done"));
}
