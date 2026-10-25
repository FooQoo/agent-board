//! The guide's sample cards keep their identity and stay out of agent-facing selection.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use agent_board::domain::ProjectId;
use agent_board::file_store::FileStore;
use serde_json::{Value, json};
use tempfile::tempdir;

const RUN_ID: &str = "0123456789abcdef0123456789abcdef";

fn agboard(home: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args(args)
        .output()
        .unwrap()
}

fn success(home: &Path, args: &[&str]) -> String {
    let output = agboard(home, args);
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn json(home: &Path, args: &[&str]) -> Value {
    serde_json::from_str(&success(home, args)).unwrap()
}

fn project(home: &Path, name: &str) -> ProjectId {
    let folder = home.join(format!("folder-{name}"));
    fs::create_dir_all(&folder).unwrap();
    success(
        home,
        &[
            "project",
            "create",
            name,
            "--folder",
            &folder.display().to_string(),
        ],
    );
    FileStore::open(&home.join("shared"))
        .project_by_name(name)
        .unwrap()
        .id
}

/// Starts `agboard serve` on a free port, which `wait` needs, and returns the port it bound.
fn serve(home: &Path) -> (Child, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args(["serve", "--port", "0"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let port = line.trim().rsplit(':').next().unwrap().to_string();
    (child, port)
}

fn task_json_path(home: &Path, project: &ProjectId, id: i64) -> PathBuf {
    home.join("shared")
        .join("projects")
        .join(project.to_string())
        .join("tasks")
        .join(id.to_string())
        .join("task.json")
}

/// Marks a card as a guide sample the way the guide's own run will: its stored identity.
fn mark_as_sample(home: &Path, project: &ProjectId, id: i64, ordinal: u8) {
    let path = task_json_path(home, project, id);
    let mut value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    value["onboardingSample"] = json!({ "runId": RUN_ID, "ordinal": ordinal });
    fs::write(&path, serde_json::to_string_pretty(&value).unwrap()).unwrap();
}

fn stored_identity(home: &Path, project: &ProjectId, id: i64) -> Option<Value> {
    let value: Value =
        serde_json::from_str(&fs::read_to_string(task_json_path(home, project, id)).unwrap())
            .unwrap();
    value.get("onboardingSample").cloned()
}

/// Every task ID the progress table lists, in any section.
fn listed_ids(progress: &Value) -> Vec<i64> {
    let mut ids = Vec::new();
    for epic in progress["epics"].as_array().into_iter().flatten() {
        for task in epic["tasks"].as_array().into_iter().flatten() {
            ids.push(task["id"].as_i64().unwrap());
        }
    }
    for section in ["unassigned", "pending", "done"] {
        for task in progress[section].as_array().into_iter().flatten() {
            ids.push(task["id"].as_i64().unwrap());
        }
    }
    ids
}

#[test]
fn a_sample_is_left_out_of_progress_and_wait_but_stays_readable() {
    let home = tempdir().unwrap();
    let home = home.path();
    let project_id = project(home, "onboarding");
    success(
        home,
        &[
            "--project",
            "onboarding",
            "add",
            "sample",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    );
    mark_as_sample(home, &project_id, 1, 1);

    let progress = json(
        home,
        &[
            "--project",
            "onboarding",
            "progress",
            "--include-pending",
            "--json",
        ],
    );
    assert!(!listed_ids(&progress).contains(&1), "{progress}");

    let (mut server, _) = serve(home);
    let waited = json(
        home,
        &[
            "--project",
            "onboarding",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "1",
            "--json",
        ],
    );
    server.kill().unwrap();
    let _ = server.wait();
    assert_eq!(waited["kind"], "idle_timeout", "{waited}");

    let shown = json(home, &["--project", "onboarding", "show", "1", "--json"]);
    assert_eq!(shown["task"]["onboardingSample"]["ordinal"], 1, "{shown}");
    assert_eq!(
        shown["task"]["onboardingSample"]["runId"], RUN_ID,
        "{shown}"
    );
}

#[test]
fn an_ordinary_card_is_still_selected_next_to_a_sample() {
    let home = tempdir().unwrap();
    let home = home.path();
    let project_id = project(home, "mixed");
    success(
        home,
        &[
            "--project",
            "mixed",
            "add",
            "sample",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    );
    success(
        home,
        &[
            "--project",
            "mixed",
            "add",
            "ordinary",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    );
    mark_as_sample(home, &project_id, 1, 1);

    let progress = json(home, &["--project", "mixed", "progress", "--json"]);
    assert_eq!(listed_ids(&progress), vec![2], "{progress}");

    let (mut server, _) = serve(home);
    let waited = json(
        home,
        &[
            "--project",
            "mixed",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "5",
            "--json",
        ],
    );
    server.kill().unwrap();
    let _ = server.wait();
    assert_eq!(waited["kind"], "task", "{waited}");
    assert_eq!(waited["task"]["id"], 2, "{waited}");
}

#[test]
fn the_identity_survives_lane_moves_and_history_updates() {
    let home = tempdir().unwrap();
    let home = home.path();
    let project_id = project(home, "survive");
    success(
        home,
        &[
            "--project",
            "survive",
            "add",
            "sample",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    );
    mark_as_sample(home, &project_id, 1, 2);
    let before = stored_identity(home, &project_id, 1).unwrap();

    success(
        home,
        &[
            "--project",
            "survive",
            "mv",
            "1",
            "doing",
            "--actor",
            "ai",
            "--reason",
            "start",
        ],
    );
    success(
        home,
        &[
            "--project",
            "survive",
            "history",
            "add",
            "1",
            "--reason",
            "progress",
        ],
    );

    assert_eq!(stored_identity(home, &project_id, 1), Some(before));
}

#[test]
fn an_ordinary_card_never_carries_the_identity_field() {
    let home = tempdir().unwrap();
    let home = home.path();
    let project_id = project(home, "plain");
    success(
        home,
        &[
            "--project",
            "plain",
            "add",
            "plain",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    );

    assert_eq!(stored_identity(home, &project_id, 1), None);
    let shown = json(home, &["--project", "plain", "show", "1", "--json"]);
    assert!(shown["task"].get("onboardingSample").is_none(), "{shown}");
}

#[test]
fn creation_has_no_way_to_set_the_identity() {
    let home = tempdir().unwrap();
    let home = home.path();
    project(home, "guarded");
    let help = success(home, &["--project", "guarded", "add", "--help"]);
    assert!(!help.to_lowercase().contains("onboarding"), "{help}");
}
