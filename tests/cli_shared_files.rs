//! The CLI on the shared files: the first project creates the folder,
//! `workspace --json`, and the content-version cursor. Each test runs the real binary against a temporary data area.

use std::path::Path;

use assert_cmd::Command;
use serde_json::Value;

fn agboard(home: &Path) -> Command {
    let mut cmd = Command::cargo_bin("agboard").unwrap();
    cmd.env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .current_dir(home);
    cmd
}

fn json(home: &Path, args: &[&str]) -> Value {
    let out = agboard(home).args(args).assert().success();
    serde_json::from_slice(&out.get_output().stdout).unwrap()
}

/// A data area with one project named "Demo"; returns its ID.
fn demo(home: &Path) -> String {
    agboard(home)
        .args(["project", "create", "Demo"])
        .assert()
        .success();
    json(home, &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn the_first_project_creates_the_shared_folder() {
    let home = tempfile::tempdir().unwrap();
    let id = demo(home.path());

    let shared = home.path().join("shared");
    assert_eq!(
        serde_json::from_str::<Value>(
            &std::fs::read_to_string(shared.join("workspace.json")).unwrap()
        )
        .unwrap(),
        serde_json::json!({"format": "agboard-files", "formatVersion": 1})
    );
    let project = shared.join("projects").join(&id);
    assert!(project.join("project.json").is_file());
    assert!(project.join("README.md").is_file());
    assert!(project.join("tasks").is_dir());
}

#[test]
fn workspace_json_names_the_project_id_the_folder_and_the_readme() {
    let home = tempfile::tempdir().unwrap();
    let id = demo(home.path());

    let workspace = json(home.path(), &["--project", "Demo", "workspace", "--json"]);
    assert_eq!(workspace["projectId"], id);
    let folder = Path::new(workspace["folder"].as_str().unwrap());
    assert!(folder.is_absolute(), "{folder:?}");
    assert!(folder.join("project.json").is_file());
    let readme = Path::new(workspace["readme"].as_str().unwrap());
    assert!(readme.is_absolute() && readme.is_file(), "{readme:?}");
}

#[test]
fn a_cursor_names_the_content_version_and_a_different_version_answers_at_once() {
    let home = tempfile::tempdir().unwrap();
    let id = demo(home.path());
    let before = json(home.path(), &["--project", "Demo", "snapshot", "--json"]);
    let cursor = before["cursor"].as_str().unwrap().to_string();
    assert_eq!(
        cursor,
        format!("f1:{id}:{}", before["version"].as_str().unwrap())
    );

    // The same version does not answer: with no time to wait, the answer is a timeout.
    agboard(home.path())
        .args([
            "--project",
            "Demo",
            "wait",
            "--after",
            &cursor,
            "--timeout",
            "0",
            "--json",
        ])
        .assert()
        .code(1)
        .stderr(predicates::str::contains("wait_timeout"));

    // After a change the version differs, so the same old cursor is answered at once.
    agboard(home.path())
        .args([
            "--project", "Demo", "add", "Changed", "--assignee", "ai", "--actor", "ai",
            "--desc", "## 作業内容\n\nWork.\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n",
        ])
        .assert()
        .success();
    let answer = json(
        home.path(),
        &[
            "--project",
            "Demo",
            "wait",
            "--after",
            &cursor,
            "--timeout",
            "0",
            "--json",
        ],
    );
    assert_eq!(answer["tasks"][0]["title"], "Changed");
    assert_ne!(answer["cursor"], cursor);
}

#[test]
fn the_old_revision_cursor_is_refused() {
    let home = tempfile::tempdir().unwrap();
    let id = demo(home.path());
    let old = format!("{id}:3");
    agboard(home.path())
        .args([
            "--project",
            "Demo",
            "wait",
            "--after",
            &old,
            "--timeout",
            "0",
            "--json",
        ])
        .assert()
        .failure()
        .stderr(predicates::str::contains("f1:"));
}

#[test]
fn init_empties_the_named_project_and_keeps_its_id_name_and_task_number() {
    let home = tempfile::tempdir().unwrap();
    let id = demo(home.path());
    let body = "## 作業内容\n\nWork.\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n";
    agboard(home.path())
        .args([
            "--project",
            "Demo",
            "add",
            "First",
            "--assignee",
            "ai",
            "--actor",
            "ai",
            "--desc",
            body,
        ])
        .assert()
        .success();
    // An existing project is replaced only after a person says yes; with --json
    // the confirmation is refused and nothing changes.
    agboard(home.path())
        .args(["--project", "Demo", "--json", "init"])
        .assert()
        .code(1)
        .stderr(predicates::str::contains("confirmation_required"));
    assert_eq!(
        json(home.path(), &["--project", "Demo", "ls", "--json"])["tasks"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // The confirmed replacement itself is the store's reset: the same ID and
    // name, no tasks, and the task number is kept.
    let files = agent_board::file_store::FileStore::open(&home.path().join("shared"));
    let project = files.project_by_name("Demo").unwrap();
    assert_eq!(project.id.to_string(), id);
    assert!(files.reset_project(&project.id).unwrap().changed);
    let listed = json(home.path(), &["project", "ls", "--json"]);
    assert_eq!(listed["projects"][0]["id"], id);
    assert_eq!(listed["projects"][0]["name"], "Demo");
    let snapshot = json(home.path(), &["--project", "Demo", "snapshot", "--json"]);
    assert_eq!(snapshot["tasks"], serde_json::json!([]));
    assert_eq!(snapshot["nextTaskId"], 2);
}
