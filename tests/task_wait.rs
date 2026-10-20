//! CLI contract and event-driven task wait behavior on isolated data areas.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use agent_board::domain::{Actor, Assignee, NewTask, ProjectId};
use agent_board::file_store::FileStore;
use assert_cmd::Command as AssertCommand;
use serde_json::Value;
use tempfile::{TempDir, tempdir};

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
        "{}
{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn json(home: &Path, args: &[&str]) -> Value {
    serde_json::from_str(&success(home, args)).unwrap()
}

fn project(home: &Path, name: &str) -> ProjectId {
    let folder = home.join(format!(
        "folder-{name}-{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap()
    ));
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

fn add(home: &Path, project: &str, title: &str, assignee: &str, epic: Option<&str>) -> i64 {
    let mut args = vec![
        "--project",
        project,
        "add",
        title,
        "--assignee",
        assignee,
        "--actor",
        "ai",
        "--json",
    ];
    if let Some(epic) = epic {
        args.extend(["--epic", epic]);
    }
    json(home, &args)["task"]["id"].as_i64().unwrap()
}

fn serve(home: &Path, port: u16) -> std::process::Child {
    let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args(["serve", "--port", &port.to_string()])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    assert!(line.contains(&format!("127.0.0.1:{port}")), "{line}");
    child
}

fn wait(home: &Path, project: &str, timeout: &str) -> std::process::Child {
    Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args([
            "--project",
            project,
            "--json",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            timeout,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

fn output(child: std::process::Child) -> (std::process::Output, Duration) {
    let began = Instant::now();
    let result = child.wait_with_output().unwrap();
    (result, began.elapsed())
}

fn demo() -> (TempDir, ProjectId) {
    let home = tempdir().unwrap();
    let id = project(home.path(), "Demo");
    success(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "add",
            "ALPHA",
            "--name",
            "Alpha",
            "--actor",
            "ai",
        ],
    );
    (home, id)
}

#[test]
fn task_mode_selects_the_first_eligible_task_in_progress_order_without_writing() {
    let (home, _project_id) = demo();
    success(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "add",
            "BETA",
            "--name",
            "Beta",
            "--actor",
            "ai",
        ],
    );
    let beta = add(
        home.path(),
        "Demo",
        "beta is later by epic order",
        "ai",
        Some("BETA"),
    );
    let _human = add(home.path(), "Demo", "human", "human", Some("ALPHA"));
    let running = add(home.path(), "Demo", "running", "ai", Some("ALPHA"));
    let pending = add(home.path(), "Demo", "pending", "ai", Some("ALPHA"));
    let doing = add(home.path(), "Demo", "doing", "ai", Some("ALPHA"));
    let done = add(home.path(), "Demo", "done", "ai", Some("ALPHA"));
    let archived = add(home.path(), "Demo", "archived", "ai", Some("ALPHA"));
    let first = add(home.path(), "Demo", "priority first", "ai", Some("ALPHA"));
    let second = add(home.path(), "Demo", "priority second", "ai", Some("ALPHA"));
    let loose = add(home.path(), "Demo", "unassigned", "ai", None);

    success(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            &running.to_string(),
            "doing",
            "--actor",
            "ai",
            "--reason",
            "start",
        ],
    );
    success(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            &running.to_string(),
            "running",
            "--actor",
            "ai",
            "--reason",
            "in progress",
        ],
    );
    success(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            &pending.to_string(),
            "doing",
            "--actor",
            "ai",
            "--reason",
            "ask",
        ],
    );
    success(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            &pending.to_string(),
            "pending",
            "--actor",
            "ai",
            "--request-json",
            r#"{"question":"Wait?","choices":[]}"#,
        ],
    );
    success(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            &doing.to_string(),
            "doing",
            "--actor",
            "ai",
            "--reason",
            "started",
        ],
    );
    success(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            &done.to_string(),
            "done",
            "--actor",
            "human",
            "--reason",
            "complete",
        ],
    );
    success(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "ALPHA",
            "--priority",
            &format!("{second},{first}"),
        ],
    );

    let store = FileStore::open(&home.path().join("shared"));
    store
        .create_task(
            &store.project_by_name("Demo").unwrap().id,
            NewTask {
                title: "draft".into(),
                description: "draft body".into(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: true,
            },
            chrono::Utc::now(),
        )
        .unwrap();
    store
        .archive_task(
            &store.project_by_name("Demo").unwrap().id,
            done,
            chrono::Utc::now(),
        )
        .unwrap();
    store
        .archive_task(
            &store.project_by_name("Demo").unwrap().id,
            archived,
            chrono::Utc::now(),
        )
        .unwrap();

    let before = json(home.path(), &["--project", "Demo", "snapshot", "--json"]);
    let selected = json(
        home.path(),
        &[
            "--project",
            "Demo",
            "--json",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "10",
        ],
    );
    let after = json(home.path(), &["--project", "Demo", "snapshot", "--json"]);

    assert_eq!(selected["kind"], "task");
    assert_eq!(selected["task"]["id"], second);
    assert_eq!(selected["task"]["title"], "priority second");
    assert_ne!(selected["task"]["id"], beta);
    assert_eq!(selected["cursor"], before["cursor"]);
    assert!(selected["taskPath"].as_str().unwrap().ends_with("/TASK.md"));
    assert!(
        selected["documentPath"]
            .as_str()
            .unwrap()
            .ends_with("/EPIC.md")
    );
    assert_eq!(before["version"], after["version"]);
    assert!(loose > second);

    let mut selected_ids = vec![selected["task"]["id"].as_i64().unwrap()];
    for completed_pick in [second, first, doing, beta] {
        if completed_pick != doing {
            success(
                home.path(),
                &[
                    "--project",
                    "Demo",
                    "mv",
                    &completed_pick.to_string(),
                    "doing",
                    "--actor",
                    "ai",
                    "--reason",
                    "picked for the next step",
                ],
            );
        }
        success(
            home.path(),
            &[
                "--project",
                "Demo",
                "state",
                &completed_pick.to_string(),
                "running",
                "--actor",
                "ai",
                "--reason",
                "starting the selected task",
            ],
        );
        let next = json(
            home.path(),
            &[
                "--project",
                "Demo",
                "--json",
                "wait",
                "--until",
                "task",
                "--idle-timeout",
                "10",
            ],
        );
        selected_ids.push(next["task"]["id"].as_i64().unwrap());
        if next["task"]["id"] == loose {
            assert!(next["documentPath"].is_null());
        }
    }
    assert_eq!(selected_ids, vec![second, first, doing, beta, loose]);
}

#[test]
fn task_wait_returns_new_work_after_a_change_event() {
    let (home, _) = demo();
    let mut server = serve(home.path(), 8700);
    let waiter = wait(home.path(), "Demo", "10");
    thread::sleep(Duration::from_millis(250));
    let task_id = add(home.path(), "Demo", "arrived", "ai", None);
    let result = waiter.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let selected: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(selected["kind"], "task");
    assert_eq!(selected["task"]["id"], task_id);
    server.kill().unwrap();
    let _ = server.wait();
}

#[test]
fn unrelated_project_changes_do_not_extend_the_idle_deadline() {
    let (home, _) = demo();
    project(home.path(), "Other");
    let mut server = serve(home.path(), 8701);
    let waiter = wait(home.path(), "Demo", "2");
    thread::sleep(Duration::from_millis(800));
    add(home.path(), "Other", "irrelevant", "ai", None);
    let (result, elapsed) = output(waiter);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let value: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(value["kind"], "idle_timeout");
    assert_eq!(value["idleTimeoutSeconds"], 2);
    assert!(
        elapsed < Duration::from_millis(2800),
        "deadline was extended: {elapsed:?}"
    );
    server.kill().unwrap();
    let _ = server.wait();
}

#[test]
fn task_wait_tracks_the_original_project_id_across_rename_and_same_name_recreation() {
    let (home, original_id) = demo();
    let mut server = serve(home.path(), 8702);
    let waiter = wait(home.path(), "Demo", "10");
    thread::sleep(Duration::from_millis(250));
    success(
        home.path(),
        &["--project", "Demo", "project", "rename", "Renamed"],
    );
    project(home.path(), "Demo");
    let task_id = add(home.path(), "Renamed", "original project task", "ai", None);
    let result = waiter.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let selected: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(selected["projectId"], original_id.as_str());
    assert_eq!(selected["task"]["id"], task_id);
    server.kill().unwrap();
    let _ = server.wait();
}

#[test]
fn a_dropped_event_stream_is_an_error_not_an_idle_timeout() {
    let (home, _) = demo();
    let mut server = serve(home.path(), 8703);
    let waiter = wait(home.path(), "Demo", "10");
    thread::sleep(Duration::from_millis(250));
    server.kill().unwrap();
    let _ = server.wait();
    let result = waiter.wait_with_output().unwrap();
    assert_eq!(result.status.code(), Some(1));
    let error: Value = serde_json::from_slice(&result.stderr).unwrap();
    assert_eq!(error["error"]["code"], "board_unavailable");
}

#[test]
fn errors_and_invalid_cli_inputs_are_not_idle_completions() {
    let (home, _) = demo();
    let no_server = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "--json",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "1",
        ],
    );
    assert_eq!(no_server.status.code(), Some(1));
    let error: Value = serde_json::from_slice(&no_server.stderr).unwrap();
    assert_eq!(error["error"]["code"], "board_unavailable");

    for args in [
        vec!["--project", "Demo", "wait"],
        vec!["--project", "Demo", "wait", "--until", "task"],
        vec![
            "--project",
            "Demo",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "0",
        ],
        vec![
            "--project",
            "Demo",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "86401",
            "--after",
            "f1:0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef",
        ],
        vec!["--project", "Demo", "wait", "--timeout", "1"],
    ] {
        let output = AssertCommand::cargo_bin("agboard")
            .unwrap()
            .env("AGBOARD_HOME", home.path())
            .env("TZ", "UTC")
            .args(args)
            .assert()
            .code(2)
            .get_output()
            .clone();
        assert!(!output.stdout.is_empty() || !output.stderr.is_empty());
    }
}

#[test]
fn malformed_project_data_fails_instead_of_becoming_an_idle_timeout() {
    let (home, project_id) = demo();
    let task_id = add(home.path(), "Demo", "broken", "ai", None);
    let task_json = home
        .path()
        .join("shared/projects")
        .join(project_id.as_str())
        .join("tasks")
        .join(task_id.to_string())
        .join("task.json");
    fs::write(task_json, "{").unwrap();

    let result = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "--json",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "1",
        ],
    );
    assert_eq!(result.status.code(), Some(1));
    let error: Value = serde_json::from_slice(&result.stderr).unwrap();
    assert_eq!(error["error"]["code"], "board_unavailable");
    assert_ne!(error["error"]["code"], "idle_timeout");
}
