use std::io::Cursor;
use std::process::{Command, Stdio};

use serde_json::Value;
use tempfile::tempdir;

#[test]
fn hook_adds_the_progress_table_for_supported_events_without_mutating_data() {
    let home = tempdir().unwrap();
    for project in ["Agent Board", "Other"] {
        let init = Command::new(env!("CARGO_BIN_EXE_agboard"))
            .env("AGBOARD_WATCH", "poll")
            .env("AGBOARD_HOME", home.path())
            .args(["--project", project, "init"])
            .output()
            .unwrap();
        assert!(init.status.success());
        let title = if project == "Other" {
            "Not for this hook"
        } else {
            "Question"
        };
        let add = Command::new(env!("CARGO_BIN_EXE_agboard"))
            .env("AGBOARD_WATCH", "poll")
            .env("AGBOARD_HOME", home.path())
            .args([
                "--project",
                project,
                "add",
                title,
                "--assignee",
                "ai",
                "--actor",
                "ai",
            ])
            .output()
            .unwrap();
        assert!(add.status.success());
    }
    let db_path = home.path().join("shared");
    let before = tree_of(&db_path);
    let input = br#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"ignored"}}"#;
    let mut cursor = Cursor::new(input);
    let result =
        agent_board::agent::hook::run("claude", &mut cursor, &db_path, Some("Agent Board"))
            .unwrap();
    let parsed: Value = serde_json::from_str(&result).unwrap();
    assert_eq!(
        parsed["hookSpecificOutput"]["hookEventName"],
        "PostToolUseFailure"
    );
    let context = parsed["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(context.starts_with("AGBOARD_PROGRESS\n"));
    let snapshot: Value = serde_json::from_str(context.split_once('\n').unwrap().1).unwrap();
    assert_eq!(snapshot["project"]["name"], "Agent Board");
    // Work metadata is included, while details/history are not sent to the hook.
    assert_eq!(snapshot["unassigned"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["unassigned"][0]["title"], "Question");
    assert!(snapshot.get("tasks").is_none());
    assert!(snapshot.get("sessionId").is_none());
    assert_eq!(snapshot["epics"].as_array().unwrap().len(), 0);
    assert_eq!(before, tree_of(&db_path));
    assert!(
        agent_board::agent::hook::run(
            "codex",
            &mut Cursor::new(br#"{"hook_event_name":"PostToolUseFailure"}"#),
            &db_path,
            Some("Agent Board")
        )
        .is_none()
    );
}

#[test]
fn hook_failure_is_bounded_and_does_not_create_a_missing_database() {
    let home = tempdir().unwrap();
    let db_path = home.path().join("missing.db");
    let input = br#"{"hook_event_name":"SessionStart"}"#;
    let output =
        agent_board::agent::hook::run("codex", &mut Cursor::new(input), &db_path, Some("demo"))
            .unwrap();
    assert!(output.contains("AGBOARD_ERROR"));
    assert!(!db_path.exists());
    // A readable, unbound hook folder says nothing and creates nothing.
    assert!(
        agent_board::agent::hook::run("codex", &mut Cursor::new(input), &db_path, None).is_none()
    );
    assert!(!db_path.exists());
    let oversized = vec![b'x'; 65_537];
    let output = agent_board::agent::hook::run(
        "claude",
        &mut Cursor::new(oversized),
        &db_path,
        Some("demo"),
    )
    .unwrap();
    assert!(output.contains("hook_input_too_large"));
    assert!(!db_path.exists());
}

/// Every file below `dir` with its bytes, sorted: the state a read must not change.
fn tree_of(dir: &std::path::Path) -> Vec<(std::path::PathBuf, Vec<u8>)> {
    let mut found = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(next) = pending.pop() {
        for entry in std::fs::read_dir(&next).unwrap().map(Result::unwrap) {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                found.push((path.clone(), std::fs::read(&path).unwrap()));
            }
        }
    }
    found.sort();
    found
}

/// A TASK.md body whose work section holds `text`, which the file store accepts.
fn task_body(text: &str) -> String {
    format!(
        "## 作業内容\n\n{text}\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n"
    )
}

fn board_with_descriptions(descriptions: &[String]) -> (tempfile::TempDir, std::path::PathBuf) {
    use agent_board::domain::{Actor, Assignee, NewTask};
    use agent_board::file_store::FileStore;
    let home = tempdir().unwrap();
    let db_path = home.path().join("shared");
    let store = FileStore::open(&db_path);
    let now = chrono::Utc::now();
    let project = store.create_project("Agent Board", now).unwrap().id;
    for (index, description) in descriptions.iter().enumerate() {
        // The description limit counts the whole TASK.md body, headings included.
        let room = 50_000 - task_body("").chars().count();
        let description: String = description.chars().take(room).collect();
        store
            .create_task(
                &project,
                NewTask {
                    title: format!("Task {index}"),
                    description: task_body(&description),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                    is_draft: false,
                },
                now,
            )
            .unwrap();
    }
    (home, db_path)
}

fn hook_context(agent: &str, event: &str, db_path: &std::path::Path) -> String {
    let input = format!(r#"{{"hook_event_name":"{event}"}}"#);
    let output = agent_board::agent::hook::run(
        agent,
        &mut Cursor::new(input.into_bytes()),
        db_path,
        Some("Agent Board"),
    )
    .unwrap();
    let parsed: Value = serde_json::from_str(&output).unwrap();
    parsed["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn hook_omits_long_descriptions_from_the_progress_table() {
    let ten_kb = "a".repeat(10 * 1024);
    let forty_kb = format!("{}\r\nend", "b".repeat(40 * 1024));
    let (_home, db_path) =
        board_with_descriptions(&[ten_kb.clone(), forty_kb, "c".repeat(30 * 1024)]);
    for (agent, event) in [
        ("claude", "PostToolUse"),
        ("claude", "SessionStart"),
        ("codex", "PostToolUse"),
        ("codex", "SessionStart"),
    ] {
        let context = hook_context(agent, event, &db_path);
        assert!(context.starts_with("AGBOARD_PROGRESS\n"), "{agent} {event}");
        assert!(context.len() < 10 * 1024);
        let snapshot: Value = serde_json::from_str(context.split_once('\n').unwrap().1).unwrap();
        assert!(snapshot.get("tasks").is_none());
        assert!(!context.contains(&ten_kb));
        assert!(!context.contains("end"));
    }
}

#[test]
fn hook_progress_size_depends_on_work_metadata_not_markdown_bodies() {
    // Large markdown bodies do not make the compact progress table oversized.
    let (_home, db_path) = board_with_descriptions(&["あ".repeat(50_000), "あ".repeat(50_000)]);
    for (agent, event) in [("claude", "PostToolUse"), ("codex", "SessionStart")] {
        let context = hook_context(agent, event, &db_path);
        assert!(context.starts_with("AGBOARD_PROGRESS\n"));
        assert!(context.len() < 10 * 1024);
        assert!(!context.contains("あ"));
    }
}

#[test]
fn hook_input_limit_stays_at_64_kib() {
    let (_home, db_path) = board_with_descriptions(&[]);
    let mut at_limit = br#"{"hook_event_name":"PostToolUse","x":""#.to_vec();
    at_limit.resize(64 * 1024 - 2, b'x');
    at_limit.extend_from_slice(b"\"}");
    assert_eq!(at_limit.len(), 64 * 1024);
    let ok = agent_board::agent::hook::run(
        "claude",
        &mut Cursor::new(at_limit.clone()),
        &db_path,
        Some("Agent Board"),
    )
    .unwrap();
    assert!(ok.contains("AGBOARD_PROGRESS"));
    at_limit.push(b' ');
    let over = agent_board::agent::hook::run(
        "claude",
        &mut Cursor::new(at_limit),
        &db_path,
        Some("Agent Board"),
    )
    .unwrap();
    assert!(over.contains("hook_input_too_large"));
}

#[test]
fn installed_binary_handles_hook_json_on_stdin() {
    let home = tempdir().unwrap();
    let init = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_WATCH", "poll")
        .env("AGBOARD_HOME", home.path())
        .args(["--project", "Agent Board", "init"])
        .output()
        .unwrap();
    assert!(init.status.success());
    let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_WATCH", "poll")
        .env("AGBOARD_HOME", home.path())
        .args(["--project", "Agent Board", "hook", "--agent", "codex"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    use std::io::Write;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(br#"{"hook_event_name":"SessionStart"}"#)
        .unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(result.status.success());
    assert!(
        String::from_utf8(result.stdout)
            .unwrap()
            .contains("AGBOARD_PROGRESS")
    );
}

// ---- unbound and strict binding resolution -------------------------------------

struct HookRun {
    status: i32,
    stdout: String,
    stderr: String,
}

fn agboard_in(home: &std::path::Path, cwd: &std::path::Path, args: &[&str]) -> HookRun {
    hook_process(home, cwd, args, None)
}

fn hook_process(
    home: &std::path::Path,
    cwd: &std::path::Path,
    args: &[&str],
    stdin: Option<&str>,
) -> HookRun {
    use std::io::Write;
    let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_WATCH", "poll")
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .current_dir(cwd)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut pipe = child.stdin.take().unwrap();
    if let Some(text) = stdin {
        pipe.write_all(text.as_bytes()).unwrap();
    }
    drop(pipe);
    let out = child.wait_with_output().unwrap();
    HookRun {
        status: out.status.code().unwrap(),
        stdout: String::from_utf8(out.stdout).unwrap(),
        stderr: String::from_utf8(out.stderr).unwrap(),
    }
}

fn hook(home: &std::path::Path, cwd: &std::path::Path, extra: &[&str], input: &str) -> HookRun {
    let mut args = vec!["hook", "--agent", "claude"];
    args.extend_from_slice(extra);
    hook_process(home, cwd, &args, Some(input))
}

fn hook_input(cwd: Option<&str>) -> String {
    match cwd {
        Some(cwd) => serde_json::json!({"hook_event_name": "SessionStart", "cwd": cwd}).to_string(),
        None => r#"{"hook_event_name":"SessionStart"}"#.to_string(),
    }
}

fn error_of(run: &HookRun) -> Value {
    assert_eq!(run.status, 0, "{}", run.stderr);
    assert_eq!(run.stderr, "");
    let parsed: Value = serde_json::from_str(&run.stdout).unwrap();
    let context = parsed["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    let body = context
        .strip_prefix("AGBOARD_ERROR\n")
        .unwrap_or_else(|| panic!("not an error: {context}"));
    serde_json::from_str(body.lines().next().unwrap()).unwrap()
}

fn project_of(run: &HookRun) -> String {
    assert_eq!(run.status, 0, "{}", run.stderr);
    let parsed: Value = serde_json::from_str(&run.stdout).unwrap();
    let context = parsed["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    let json = context.strip_prefix("AGBOARD_PROGRESS\n").unwrap();
    let snapshot: Value = serde_json::from_str(json).unwrap();
    snapshot["project"]["name"].as_str().unwrap().to_string()
}

fn create_project(home: &std::path::Path, folder: &std::path::Path, name: &str) {
    std::fs::create_dir_all(folder).unwrap();
    let run = agboard_in(home, folder, &["project", "create", name]);
    assert_eq!(run.status, 0, "{}", run.stderr);
}

fn assert_silent(run: &HookRun) {
    assert_eq!(run.status, 0);
    assert_eq!(run.stdout, "");
    assert_eq!(run.stderr, "");
}

#[test]
fn hook_resolves_the_bind_root_child_folder_and_the_nearest_nested_bind() {
    let home = tempdir().unwrap();
    let folders = tempdir().unwrap();
    let root = std::fs::canonicalize(folders.path()).unwrap().join("root");
    let nested = root.join("nested");
    create_project(home.path(), &root, "Alpha");
    create_project(home.path(), &nested, "Beta");
    std::fs::create_dir_all(root.join("child/deep")).unwrap();
    std::fs::create_dir_all(nested.join("deeper")).unwrap();
    let elsewhere = tempdir().unwrap();

    for (cwd, expected) in [
        (root.clone(), "Alpha"),
        (root.join("child/deep"), "Alpha"),
        (nested.clone(), "Beta"),
        (nested.join("deeper"), "Beta"),
    ] {
        // From the input cwd, with the process folder somewhere unrelated.
        let run = hook(
            home.path(),
            elsewhere.path(),
            &[],
            &hook_input(Some(cwd.to_str().unwrap())),
        );
        assert_eq!(project_of(&run), expected, "{cwd:?}");
        // From the process folder, when the input has no cwd.
        let run = hook(home.path(), &cwd, &[], &hook_input(None));
        assert_eq!(project_of(&run), expected, "{cwd:?}");
    }
}

#[test]
fn hook_for_a_readable_unbound_folder_is_silent_and_never_reads_the_board() {
    let home = tempdir().unwrap();
    let folders = tempdir().unwrap();
    let bound = folders.path().join("bound");
    let unbound = folders.path().join("unbound");
    create_project(home.path(), &bound, "Alpha");
    std::fs::create_dir_all(&unbound).unwrap();
    let before = tree_of(home.path());

    assert_silent(&hook(home.path(), &unbound, &[], &hook_input(None)));
    for cwd in [Some(unbound.to_str().unwrap()), Some(""), None] {
        let input = match cwd {
            Some(cwd) => serde_json::json!({"hook_event_name":"SessionStart","cwd":cwd}),
            None => serde_json::json!({"hook_event_name":"SessionStart","cwd":null}),
        };
        assert_silent(&hook(home.path(), &unbound, &[], &input.to_string()));
    }
    assert_eq!(before, tree_of(home.path()));

    // The board files are not read: an unreadable project folder changes nothing.
    let other = tempdir().unwrap();
    assert_silent(&hook(other.path(), &unbound, &[], &hook_input(None)));
}

#[test]
fn hook_with_a_missing_or_corrupt_shared_folder_stays_silent_when_unbound() {
    let home = tempdir().unwrap();
    let work = tempdir().unwrap();
    assert_silent(&hook(home.path(), work.path(), &[], &hook_input(None)));
    assert!(!home.path().join("shared").exists());
}

#[test]
fn hook_reports_a_broken_bindings_file_instead_of_treating_it_as_unbound() {
    let home = tempdir().unwrap();
    let work = tempdir().unwrap();
    std::fs::write(home.path().join("bindings.json"), "{ broken").unwrap();
    let run = hook(home.path(), work.path(), &[], &hook_input(None));
    assert_eq!(error_of(&run)["code"], "file_invalid");
}

#[test]
fn hook_reports_a_missing_nearest_project_and_never_uses_the_parent_bind() {
    let home = tempdir().unwrap();
    let folders = tempdir().unwrap();
    let root = std::fs::canonicalize(folders.path()).unwrap().join("root");
    let nested = root.join("nested");
    create_project(home.path(), &root, "Alpha");
    create_project(home.path(), &nested, "Beta");
    std::fs::create_dir_all(nested.join("deeper")).unwrap();
    let store = agent_board::file_store::FileStore::open(&home.path().join("shared"));
    let beta = store
        .project_by_name(&agent_board::domain::validate_project_name("Beta").unwrap())
        .unwrap();
    store.delete_project(&beta.id).unwrap();

    let run = hook(home.path(), &nested.join("deeper"), &[], &hook_input(None));
    assert_eq!(error_of(&run)["code"], "bound_project_missing");
    // The parent folder is still Alpha.
    assert_eq!(
        project_of(&hook(home.path(), &root, &[], &hook_input(None))),
        "Alpha"
    );
}

#[test]
fn hook_diagnoses_an_unusable_input_cwd_and_does_not_skip() {
    let home = tempdir().unwrap();
    let folders = tempdir().unwrap();
    let root = std::fs::canonicalize(folders.path()).unwrap().join("root");
    create_project(home.path(), &root, "Alpha");
    let file = root.join("a-file");
    std::fs::write(&file, "x").unwrap();
    let missing = root.join("does-not-exist");

    let wrong_type = [
        r#"{"hook_event_name":"SessionStart","cwd":7}"#,
        r#"{"hook_event_name":"SessionStart","cwd":["/"]}"#,
        r#"{"hook_event_name":"SessionStart","cwd":{"a":1}}"#,
        r#"{"hook_event_name":"SessionStart","cwd":true}"#,
    ];
    for input in wrong_type {
        let run = hook(home.path(), &root, &[], input);
        assert_eq!(error_of(&run)["code"], "invalid_hook_input", "{input}");
    }
    let relative = hook(home.path(), &root, &[], &hook_input(Some("child/dir")));
    assert_eq!(error_of(&relative)["code"], "invalid_hook_input");
    let absent = hook(
        home.path(),
        &root,
        &[],
        &hook_input(Some(missing.to_str().unwrap())),
    );
    assert_eq!(error_of(&absent)["code"], "hook_cwd_unavailable");
    let not_a_folder = hook(
        home.path(),
        &root,
        &[],
        &hook_input(Some(file.to_str().unwrap())),
    );
    assert_eq!(error_of(&not_a_folder)["code"], "hook_cwd_unavailable");
}

#[cfg(unix)]
#[test]
fn hook_diagnoses_an_input_cwd_it_has_no_permission_to_read() {
    use std::os::unix::fs::PermissionsExt;
    let home = tempdir().unwrap();
    let folders = tempdir().unwrap();
    let root = std::fs::canonicalize(folders.path()).unwrap().join("root");
    create_project(home.path(), &root, "Alpha");
    let locked = root.join("locked");
    std::fs::create_dir_all(&locked).unwrap();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
    let readable_anyway = std::fs::read_dir(&locked).is_ok(); // e.g. running as root
    let run = hook(
        home.path(),
        &root,
        &[],
        &hook_input(Some(locked.to_str().unwrap())),
    );
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
    if !readable_anyway {
        assert_eq!(error_of(&run)["code"], "hook_cwd_unavailable");
    }
}

#[test]
fn hook_with_an_explicit_project_wins_over_the_folder_and_a_missing_one_is_an_error() {
    let home = tempdir().unwrap();
    let folders = tempdir().unwrap();
    let root = folders.path().join("root");
    let unbound = folders.path().join("unbound");
    create_project(home.path(), &root, "Alpha");
    std::fs::create_dir_all(&unbound).unwrap();
    create_project(home.path(), &folders.path().join("beta"), "Beta");

    // The named project wins over the bound folder, and works from an unbound one.
    let run = hook(
        home.path(),
        &root,
        &["--project", "Beta"],
        &hook_input(None),
    );
    assert_eq!(project_of(&run), "Beta");
    let run = hook(
        home.path(),
        &unbound,
        &["--project", "Beta"],
        &hook_input(None),
    );
    assert_eq!(project_of(&run), "Beta");
    // An unknown name is an error even from an unbound folder, never a skip.
    let run = hook(
        home.path(),
        &unbound,
        &["--project", "Nope"],
        &hook_input(None),
    );
    assert_eq!(error_of(&run)["code"], "project_not_found");
    // An explicit project does not depend on the cwd being usable.
    let run = hook(
        home.path(),
        &unbound,
        &["--project", "Beta"],
        r#"{"hook_event_name":"SessionStart","cwd":7}"#,
    );
    assert_eq!(project_of(&run), "Beta");
}

#[test]
fn hook_keeps_its_event_allow_list_and_json_errors_for_unbound_folders() {
    let home = tempdir().unwrap();
    let work = tempdir().unwrap();
    assert_silent(&hook(
        home.path(),
        work.path(),
        &[],
        r#"{"hook_event_name":"UserPromptSubmit"}"#,
    ));
    let run = hook(home.path(), work.path(), &[], "not json");
    assert_eq!(error_of(&run)["code"], "invalid_hook_input");
    let big = format!(
        r#"{{"hook_event_name":"SessionStart","x":"{}"}}"#,
        "x".repeat(70_000)
    );
    let run = hook(home.path(), work.path(), &[], &big);
    assert_eq!(error_of(&run)["code"], "hook_input_too_large");
}

#[test]
fn normal_progress_keeps_folder_unbound_for_an_unbound_folder() {
    let home = tempdir().unwrap();
    let work = tempdir().unwrap();
    let run = agboard_in(home.path(), work.path(), &["progress", "--json"]);
    assert_eq!(run.status, 4);
    assert_eq!(run.stdout, "");
    let err: Value = serde_json::from_str(&run.stderr).unwrap();
    assert_eq!(err["error"]["code"], "folder_unbound");
}
