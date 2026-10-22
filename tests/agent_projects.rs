//! Hook and wait act on exactly the project they were told to, by a name that
//! is resolved to an ID once. These tests run the real binary, a real server
//! and a temporary data area.

mod common;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;
use tempfile::tempdir;

fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_agboard"))
}

fn agboard(home: &Path, project: &str, args: &[&str]) -> Output {
    bin()
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args(["--project", project])
        .args(args)
        .output()
        .unwrap()
}

fn agboard_in(home: &Path, cwd: &Path, args: &[&str]) -> Output {
    bin()
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap()
}

fn ok(output: &Output) {
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn add_task(home: &Path, project: &str, title: &str) {
    ok(&agboard(
        home,
        project,
        &["add", title, "--assignee", "ai", "--actor", "ai"],
    ));
}

/// Every file below `dir` with its bytes, sorted: the state a read must not change.
fn tree_of(dir: &Path) -> Vec<(std::path::PathBuf, Vec<u8>)> {
    let mut found = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(next) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&next) else {
            continue;
        };
        for entry in entries.map(Result::unwrap) {
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

fn snapshot(home: &Path, project: &str) -> Value {
    let output = agboard(home, project, &["snapshot", "--json"]);
    ok(&output);
    serde_json::from_slice(&output.stdout).unwrap()
}

/// The snapshot without the time it was fetched, for comparing contents.
fn content(mut snapshot: Value) -> Value {
    snapshot.as_object_mut().unwrap().remove("fetchedAt");
    snapshot
}

/// Runs `agboard [--project NAME] hook --agent AGENT` with `input` on stdin.
fn hook(home: &Path, project: Option<&str>, agent: &str, input: &str) -> Output {
    hook_in(home, project, agent, input, None)
}

fn hook_in(
    home: &Path,
    project: Option<&str>,
    agent: &str,
    input: &str,
    cwd: Option<&Path>,
) -> Output {
    let mut command = bin();
    command.env("AGBOARD_HOME", home);
    command.env("TZ", "UTC");
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    if let Some(project) = project {
        command.args(["--project", project]);
    }
    let mut child = command
        .args(["hook", "--agent", agent])
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
    child.wait_with_output().unwrap()
}

fn context(output: &Output) -> String {
    assert!(output.status.success());
    let parsed: Value = serde_json::from_slice(&output.stdout).unwrap();
    parsed["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap()
        .to_string()
}

fn error_code(context: &str) -> String {
    let body = context
        .strip_prefix("AGBOARD_ERROR\n")
        .unwrap_or_else(|| panic!("not a hook error: {context}"))
        .lines()
        .next()
        .unwrap();
    let parsed: Value = serde_json::from_str(body).unwrap();
    parsed["code"].as_str().unwrap().to_string()
}

const SESSION_START: &str = r#"{"hook_event_name":"SessionStart"}"#;

/// A running `agboard serve`, stopped when dropped, so that a failing test
/// does not leave it behind.
struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start_server(home: &Path) -> Server {
    let mut server = bin()
        .env("AGBOARD_HOME", home)
        .args(["serve", "--port", "0"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(server.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    assert!(line.contains("http://127.0.0.1:"), "{line}");
    Server(server)
}

fn stop(server: Server) {
    drop(server);
}

fn spawn_wait(home: &Path, project: &str, after: &str, timeout: Option<&str>) -> Child {
    let mut command = bin();
    command.env("AGBOARD_HOME", home).args([
        "--project",
        project,
        "--json",
        "wait",
        "--after",
        after,
    ]);
    if let Some(timeout) = timeout {
        command.args(["--timeout", timeout]);
    }
    // A child inherits an ignored SIGINT from a parent that was started in the
    // background (a non-interactive shell's `&`, nohup, some runners). The wait
    // must be tested with the default disposition a terminal user has, or an
    // interrupt would depend on how the whole test run was launched.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: the hook only calls the async-signal-safe `signal`.
        unsafe {
            command.pre_exec(|| {
                libc::signal(libc::SIGINT, libc::SIG_DFL);
                Ok(())
            });
        }
    }
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

/// Waits for `child` for at most `limit`; kills it and fails when it is still
/// running, so a wait that never ends cannot hang the test run.
fn finish(mut child: Child, limit: Duration) -> Output {
    let began = Instant::now();
    loop {
        if child.try_wait().unwrap().is_some() {
            return child.wait_with_output().unwrap();
        }
        if began.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            panic!("the wait did not end within {limit:?}");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn still_running(child: &mut Child, for_how_long: Duration) -> bool {
    std::thread::sleep(for_how_long);
    child.try_wait().unwrap().is_none()
}

fn error_of(output: &Output) -> Value {
    serde_json::from_slice(&output.stderr).unwrap_or_else(|_| {
        panic!(
            "stderr is not JSON: {}",
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

fn two_projects(home: &Path) {
    for (project, title) in [("Alpha", "Alpha secret"), ("Beta", "Beta secret")] {
        ok(&agboard(home, project, &["init"]));
        add_task(home, project, title);
        ok(&agboard(
            home,
            project,
            &["mv", "1", "doing", "--actor", "ai", "--reason", "Start"],
        ));
        ok(&agboard(
            home,
            project,
            &[
                "state",
                "1",
                "running",
                "--actor",
                "ai",
                "--reason",
                &format!("{project} reason"),
            ],
        ));
    }
}

// --- hook ---

#[test]
fn the_hook_passes_only_the_named_projects_progress_table() {
    let home = tempdir().unwrap();
    // Both projects have a task #1, so a mix-up would be visible.
    ok(&agboard(home.path(), "Alpha", &["init"]));
    ok(&agboard(home.path(), "Beta", &["init"]));
    for (project, title) in [("Alpha", "Alpha secret"), ("Beta", "Beta secret")] {
        add_task(home.path(), project, title);
        ok(&agboard(
            home.path(),
            project,
            &[
                "mv",
                "1",
                "doing",
                "--actor",
                "ai",
                "--reason",
                &format!("{project} started"),
            ],
        ));
        ok(&agboard(
            home.path(),
            project,
            &[
                "state",
                "1",
                "pending",
                "--actor",
                "ai",
                "--request-json",
                &common::decision_json(&format!("{project} needs a decision")),
                "--no-wait",
            ],
        ));
    }
    let before = tree_of(&home.path().join("shared"));
    for (project, other, agent) in [("Alpha", "Beta", "claude"), ("Beta", "Alpha", "codex")] {
        let output = hook(home.path(), Some(project), agent, SESSION_START);
        assert!(output.stderr.is_empty());
        let context = context(&output);
        let body = context.strip_prefix("AGBOARD_PROGRESS\n").unwrap();
        let passed: Value = serde_json::from_str(body).unwrap();
        assert_eq!(passed["project"]["name"], project);
        assert!(passed["unassigned"].as_array().unwrap().is_empty());
        assert!(passed.get("tasks").is_none());
        assert!(!context.contains("needs a decision"));
        assert!(!context.contains("started"));
        assert!(!context.contains(other), "{other} leaked into {project}");
    }
    assert_eq!(before, tree_of(&home.path().join("shared")));
}

#[test]
fn a_hook_without_a_usable_target_reports_agboard_error_and_changes_nothing() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let shared = home.path().join("shared");
    let before = tree_of(&shared);

    // No binding in the process cwd: an error report, not a guess or the only project.
    let output = hook(home.path(), None, "claude", SESSION_START);
    assert_eq!(error_code(&context(&output)), "folder_unbound");
    // An unknown name.
    let output = hook(home.path(), Some("Nowhere"), "claude", SESSION_START);
    assert_eq!(error_code(&context(&output)), "project_not_found");
    // A name that is not a valid project name.
    let output = hook(home.path(), Some("  "), "codex", SESSION_START);
    assert_eq!(error_code(&context(&output)), "invalid_value");
    // The error is data for the agent, never a snapshot.
    assert!(
        !context(&hook(home.path(), None, "codex", SESSION_START)).contains("AGBOARD_PROGRESS")
    );
    assert_eq!(before, tree_of(&shared));

    // No data area at all: nothing is created.
    let empty = tempdir().unwrap();
    let output = hook(empty.path(), Some("Alpha"), "claude", SESSION_START);
    assert_eq!(error_code(&context(&output)), "project_not_found");
    assert!(!empty.path().join("shared").exists());

    // Events the agent does not use produce no output, even without a target.
    let output = hook(
        home.path(),
        None,
        "claude",
        r#"{"hook_event_name":"UserPromptSubmit"}"#,
    );
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
}

#[test]
fn a_renamed_project_needs_its_new_name_and_a_recreated_one_is_a_new_project() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let original = snapshot(home.path(), "Alpha");
    ok(&agboard(
        home.path(),
        "Alpha",
        &["project", "rename", "Gamma"],
    ));

    // The old name no longer names anything, so the hook says so; it does not
    // fall back to another project.
    let output = hook(home.path(), Some("Alpha"), "claude", SESSION_START);
    assert_eq!(error_code(&context(&output)), "project_not_found");
    let body = context(&hook(home.path(), Some("Gamma"), "claude", SESSION_START));
    let renamed: Value =
        serde_json::from_str(body.strip_prefix("AGBOARD_PROGRESS\n").unwrap()).unwrap();
    assert_eq!(renamed["project"]["id"], original["project"]["id"]);
    assert_eq!(renamed["project"]["name"], "Gamma");

    // Creating the old name again gives another project, not the old one.
    ok(&agboard(home.path(), "Alpha", &["init"]));
    let again = context(&hook(home.path(), Some("Alpha"), "claude", SESSION_START));
    let again: Value =
        serde_json::from_str(again.strip_prefix("AGBOARD_PROGRESS\n").unwrap()).unwrap();
    assert_ne!(again["project"]["id"], original["project"]["id"]);
    assert_eq!(again["unassigned"].as_array().unwrap().len(), 0);
}

#[test]
fn progress_uses_the_nearest_bound_ancestor_and_explicit_project_overrides_it() {
    let home = tempdir().unwrap();
    let folders = tempdir().unwrap();
    let root = folders.path().join("root");
    let nested = root.join("nested");
    let deeper = nested.join("deeper");
    std::fs::create_dir_all(&deeper).unwrap();

    ok(&agboard_in(
        home.path(),
        &root,
        &["project", "create", "Alpha"],
    ));
    ok(&agboard_in(
        home.path(),
        &nested,
        &["project", "create", "Beta"],
    ));
    add_task(home.path(), "Alpha", "Root task");
    add_task(home.path(), "Beta", "Nested task");

    let nearest = agboard_in(home.path(), &deeper, &["progress", "--json"]);
    ok(&nearest);
    let nearest: Value = serde_json::from_slice(&nearest.stdout).unwrap();
    assert_eq!(nearest["project"]["name"], "Beta");
    assert_eq!(nearest["unassigned"][0]["title"], "Nested task");

    let explicit = agboard_in(
        home.path(),
        &deeper,
        &["--project", "Alpha", "progress", "--json"],
    );
    ok(&explicit);
    let explicit: Value = serde_json::from_slice(&explicit.stdout).unwrap();
    assert_eq!(explicit["project"]["name"], "Alpha");
    assert_eq!(explicit["unassigned"][0]["title"], "Root task");
}

#[test]
fn progress_does_not_guess_from_an_unbound_folder_or_fall_through_a_stale_nearest_binding() {
    let home = tempdir().unwrap();
    let folders = tempdir().unwrap();
    let root = folders.path().join("root");
    let nested = root.join("nested");
    std::fs::create_dir_all(&nested).unwrap();
    ok(&agboard_in(
        home.path(),
        &root,
        &["project", "create", "Alpha"],
    ));

    let unbound = agboard_in(home.path(), folders.path(), &["progress"]);
    assert!(!unbound.status.success());
    assert!(String::from_utf8_lossy(&unbound.stderr).contains("this folder is not bound"));

    // Existing read commands still require an explicit project.
    let still_explicit = agboard_in(home.path(), &root, &["show", "1", "--json"]);
    assert!(!still_explicit.status.success());
    assert!(String::from_utf8_lossy(&still_explicit.stderr).contains("--project NAME is required"));

    ok(&agboard_in(
        home.path(),
        &nested,
        &["project", "create", "Beta"],
    ));
    let projects = agboard_in(home.path(), &root, &["project", "ls", "--json"]);
    ok(&projects);
    let projects: Value = serde_json::from_slice(&projects.stdout).unwrap();
    let beta_id = projects["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|project| project["name"] == "Beta")
        .unwrap()["id"]
        .as_str()
        .unwrap();
    std::fs::remove_dir_all(home.path().join("shared/projects").join(beta_id)).unwrap();

    let stale = agboard_in(home.path(), &nested, &["progress"]);
    assert!(!stale.status.success());
    assert!(
        String::from_utf8_lossy(&stale.stderr)
            .contains("project bound to this folder no longer exists"),
        "{}",
        String::from_utf8_lossy(&stale.stderr)
    );

    let input = format!(
        r#"{{"hook_event_name":"SessionStart","cwd":{}}}"#,
        serde_json::to_string(nested.to_str().unwrap()).unwrap()
    );
    let stale_hook = hook_in(home.path(), None, "codex", &input, Some(&root));
    assert_eq!(
        error_code(&context(&stale_hook)),
        "bound_project_missing",
        "a missing nearest binding must not fall through to Alpha"
    );
}

#[test]
fn hook_uses_cwd_binding_and_emits_the_same_read_only_progress_snapshot() {
    let home = tempdir().unwrap();
    let folders = tempdir().unwrap();
    let root = folders.path().join("root");
    let nested = root.join("nested");
    let deeper = nested.join("deeper");
    std::fs::create_dir_all(&deeper).unwrap();
    ok(&agboard_in(
        home.path(),
        &root,
        &["project", "create", "Alpha"],
    ));
    ok(&agboard_in(
        home.path(),
        &nested,
        &["project", "create", "Beta"],
    ));
    add_task(home.path(), "Alpha", "Root task");
    add_task(home.path(), "Beta", "Nested task");

    let before = tree_of(home.path());
    let input = format!(
        r#"{{"hook_event_name":"SessionStart","cwd":{}}}"#,
        serde_json::to_string(deeper.to_str().unwrap()).unwrap()
    );
    let output = hook_in(home.path(), None, "codex", &input, Some(folders.path()));
    let passed_context = context(&output);
    let hook =
        serde_json::from_str::<Value>(passed_context.strip_prefix("AGBOARD_PROGRESS\n").unwrap())
            .unwrap();
    assert_eq!(hook["project"]["name"], "Beta");
    assert_eq!(hook["unassigned"][0]["title"], "Nested task");
    assert!(hook.get("sessionId").is_none());

    // When a client omits cwd, the process cwd is used.
    let fallback = hook_in(home.path(), None, "codex", SESSION_START, Some(&deeper));
    let fallback = context(&fallback);
    let fallback: Value =
        serde_json::from_str(fallback.strip_prefix("AGBOARD_PROGRESS\n").unwrap()).unwrap();
    assert_eq!(fallback["project"]["name"], "Beta");

    let progress = agboard_in(home.path(), &deeper, &["progress", "--json"]);
    ok(&progress);
    let mut progress: Value = serde_json::from_slice(&progress.stdout).unwrap();
    progress.as_object_mut().unwrap().remove("fetchedAt");
    let mut hook_without_time = hook;
    hook_without_time
        .as_object_mut()
        .unwrap()
        .remove("fetchedAt");
    assert_eq!(hook_without_time, progress);
    assert_eq!(before, tree_of(home.path()));
}

#[test]
fn hook_explicit_project_overrides_cwd_binding_and_missing_binding_is_an_error() {
    let home = tempdir().unwrap();
    let folders = tempdir().unwrap();
    let root = folders.path().join("root");
    let unbound = folders.path().join("unbound");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&unbound).unwrap();
    ok(&agboard_in(
        home.path(),
        &root,
        &["project", "create", "Alpha"],
    ));
    add_task(home.path(), "Alpha", "Bound task");
    ok(&agboard(home.path(), "Beta", &["init"]));
    // The unbound directory stays unregistered; Beta is used only as the
    // explicit override in the first request below.
    add_task(home.path(), "Beta", "Explicit task");

    // An explicit project has precedence over both cwd and an input cwd.
    let input = format!(
        r#"{{"hook_event_name":"SessionStart","cwd":{}}}"#,
        serde_json::to_string(root.to_str().unwrap()).unwrap()
    );
    let body = context(&hook_in(
        home.path(),
        Some("Beta"),
        "claude",
        &input,
        Some(&unbound),
    ));
    let progress: Value =
        serde_json::from_str(body.strip_prefix("AGBOARD_PROGRESS\n").unwrap()).unwrap();
    assert_eq!(progress["project"]["name"], "Beta");
    assert_eq!(progress["unassigned"][0]["title"], "Explicit task");

    let output = hook_in(home.path(), None, "claude", SESSION_START, Some(&unbound));
    assert_eq!(error_code(&context(&output)), "folder_unbound");
}

#[test]
fn hook_treats_cwd_as_a_path_and_never_interpolates_it_as_shell_text() {
    let home = tempdir().unwrap();
    let folders = tempdir().unwrap();
    let marker = folders.path().join("injected");
    let hostile = folders.path().join("repo-$(touch injected)");
    std::fs::create_dir_all(&hostile).unwrap();
    ok(&agboard_in(
        home.path(),
        &hostile,
        &["project", "create", "Literal path"],
    ));

    let input = format!(
        r#"{{"hook_event_name":"SessionStart","cwd":{}}}"#,
        serde_json::to_string(hostile.to_str().unwrap()).unwrap()
    );
    let output = hook_in(home.path(), None, "codex", &input, Some(folders.path()));
    let body = context(&output);
    let progress: Value =
        serde_json::from_str(body.strip_prefix("AGBOARD_PROGRESS\n").unwrap()).unwrap();
    assert_eq!(progress["project"]["name"], "Literal path");
    assert!(!marker.exists());
}

// --- wait ---

#[test]
fn a_change_to_another_project_does_not_end_the_wait_but_an_answer_does() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let after = snapshot(home.path(), "Alpha")["cursor"]
        .as_str()
        .unwrap()
        .to_string();
    let server = start_server(home.path());

    let mut waiter = spawn_wait(home.path(), "Alpha", &after, None);
    std::thread::sleep(Duration::from_millis(500));
    // Beta changes twice; Alpha's wait must go on.
    add_task(home.path(), "Beta", "More Beta work");
    add_task(home.path(), "Beta", "Even more Beta work");
    assert!(still_running(&mut waiter, Duration::from_millis(800)));

    // An answer in Alpha ends it with Alpha's latest snapshot.
    add_task(home.path(), "Alpha", "Alpha answer task");
    let output = finish(waiter, Duration::from_secs(10));
    ok(&output);
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["project"]["name"], "Alpha");
    assert!(result.get("fetchedAt").is_some());
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.contains("Alpha answer task"));
    assert!(!text.contains("Beta"));
    stop(server);
}

#[test]
fn a_wait_for_an_unknown_project_or_database_exits_with_not_found() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let after = snapshot(home.path(), "Alpha")["cursor"]
        .as_str()
        .unwrap()
        .to_string();
    let output = finish(
        spawn_wait(home.path(), "Nowhere", &after, Some("1")),
        Duration::from_secs(10),
    );
    assert_eq!(output.status.code(), Some(4));
    assert_eq!(error_of(&output)["error"]["code"], "project_not_found");
}

#[test]
fn a_cursor_of_another_project_is_refused_and_an_old_form_is_invalid() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let alpha = snapshot(home.path(), "Alpha");
    let beta = snapshot(home.path(), "Beta");
    let server = start_server(home.path());

    let foreign = beta["cursor"].as_str().unwrap();
    let output = finish(
        spawn_wait(home.path(), "Alpha", foreign, Some("3")),
        Duration::from_secs(10),
    );
    assert!(!output.status.success());
    assert_eq!(error_of(&output)["error"]["code"], "cursor_invalid");

    // The form of the old revision cursor is refused, whatever project it names.
    let id = alpha["project"]["id"].as_str().unwrap();
    let old_form = format!("{id}:3");
    let output = finish(
        spawn_wait(home.path(), "Alpha", &old_form, Some("3")),
        Duration::from_secs(10),
    );
    assert!(!output.status.success());

    // Any other version is answered at once with the latest snapshot.
    let old = format!("f1:{id}:{}", "0".repeat(32));
    let began = Instant::now();
    let output = finish(
        spawn_wait(home.path(), "Alpha", &old, None),
        Duration::from_secs(10),
    );
    ok(&output);
    assert!(began.elapsed() < Duration::from_secs(5));
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["version"], alpha["version"]);
    stop(server);
}

#[test]
fn a_change_made_before_the_event_stream_is_ready_is_not_lost() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let after = snapshot(home.path(), "Alpha")["cursor"]
        .as_str()
        .unwrap()
        .to_string();
    let server = start_server(home.path());
    // Confirmed after the cursor was read and before the wait starts.
    add_task(home.path(), "Alpha", "Early change");
    let output = finish(
        spawn_wait(home.path(), "Alpha", &after, None),
        Duration::from_secs(10),
    );
    ok(&output);
    assert!(String::from_utf8_lossy(&output.stdout).contains("Early change"));
    stop(server);
}

#[test]
fn a_rename_while_waiting_returns_the_latest_snapshot_of_the_same_project() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let alpha = snapshot(home.path(), "Alpha");
    let after = alpha["cursor"].as_str().unwrap().to_string();
    let server = start_server(home.path());

    let waiter = spawn_wait(home.path(), "Alpha", &after, None);
    std::thread::sleep(Duration::from_millis(500));
    ok(&agboard(
        home.path(),
        "Alpha",
        &["project", "rename", "Gamma"],
    ));
    let output = finish(waiter, Duration::from_secs(10));
    ok(&output);
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["project"]["id"], alpha["project"]["id"]);
    assert_eq!(result["project"]["name"], "Gamma");

    // A wait that started under the old name keeps following the project
    // through a rename, and a later change still reaches it.
    let after = result["cursor"].as_str().unwrap().to_string();
    let waiter = spawn_wait(home.path(), "Gamma", &after, None);
    std::thread::sleep(Duration::from_millis(500));
    ok(&agboard(
        home.path(),
        "Gamma",
        &["project", "rename", "Delta"],
    ));
    add_task(home.path(), "Delta", "After two renames");
    let output = finish(waiter, Duration::from_secs(10));
    ok(&output);
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["project"]["id"], alpha["project"]["id"]);
    assert_eq!(result["project"]["name"], "Delta");
    stop(server);
}

#[test]
fn deleting_the_project_while_waiting_is_an_error_and_a_same_name_project_is_not_followed() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let after = snapshot(home.path(), "Alpha")["cursor"]
        .as_str()
        .unwrap()
        .to_string();
    let server = start_server(home.path());
    let waiter = spawn_wait(home.path(), "Alpha", &after, None);
    std::thread::sleep(Duration::from_millis(500));

    // Delete Alpha and create another project with the same name. Deleting
    // needs a human, so this goes through the library, as the server's own
    // administrator would.
    {
        let store = agent_board::file_store::FileStore::open(&home.path().join("shared"));
        let id = store.project_by_name("Alpha").unwrap().id;
        store.delete_project(&id).unwrap();
        let now = chrono::Utc::now();
        let recreated = store.create_project("Alpha", now).unwrap();
        store
            .create_task(
                &recreated.id,
                agent_board::domain::NewTask {
                    title: "Belongs to the new Alpha".into(),
                    description: "## 作業内容\n\nNew.\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n".into(),
                    assignee: agent_board::domain::Assignee::Ai,
                    actor: agent_board::domain::Actor::Ai,
                    is_draft: false,
                },
                now,
            )
            .unwrap();
    }
    // The server is told, as it would be after a CLI change.
    let info = agent_board::paths::read_serve_info_in(home.path()).unwrap();
    assert!(agent_board::interact::notify::notify_port(
        info.port,
        Duration::from_secs(2)
    ));
    let output = finish(waiter, Duration::from_secs(10));
    assert_eq!(output.status.code(), Some(4));
    assert_eq!(error_of(&output)["error"]["code"], "project_not_found");
    assert!(!String::from_utf8_lossy(&output.stdout).contains("new Alpha"));

    // The old cursor does not belong to the project that now has the name.
    let output = finish(
        spawn_wait(home.path(), "Alpha", &after, Some("2")),
        Duration::from_secs(10),
    );
    assert_eq!(error_of(&output)["error"]["code"], "cursor_invalid");
    stop(server);
}

#[test]
fn a_notification_without_a_change_and_a_timeout_do_not_end_the_wait_as_a_success() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let after = snapshot(home.path(), "Alpha")["cursor"]
        .as_str()
        .unwrap()
        .to_string();
    let server = start_server(home.path());
    let info = agent_board::paths::read_serve_info_in(home.path()).unwrap();
    let before = snapshot(home.path(), "Alpha");

    let began = Instant::now();
    let mut waiter = spawn_wait(home.path(), "Alpha", &after, Some("4"));
    std::thread::sleep(Duration::from_millis(500));
    // A `changed` event with nothing new in this project.
    assert!(agent_board::interact::notify::notify_port(
        info.port,
        Duration::from_secs(2)
    ));
    assert!(still_running(&mut waiter, Duration::from_millis(500)));
    let output = finish(waiter, Duration::from_secs(10));
    assert!(began.elapsed() >= Duration::from_secs(3));
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(error_of(&output)["error"]["code"], "wait_timeout");
    assert!(output.stdout.is_empty());
    // Waiting changed nothing.
    assert_eq!(content(before), content(snapshot(home.path(), "Alpha")));
    stop(server);
}

#[test]
fn losing_the_server_is_board_unavailable_with_or_without_a_timeout() {
    for timeout in [None, Some("30")] {
        let home = tempdir().unwrap();
        two_projects(home.path());
        let after = snapshot(home.path(), "Alpha")["cursor"]
            .as_str()
            .unwrap()
            .to_string();
        let server = start_server(home.path());
        let waiter = spawn_wait(home.path(), "Alpha", &after, timeout);
        std::thread::sleep(Duration::from_millis(700));
        stop(server);
        let output = finish(waiter, Duration::from_secs(10));
        assert_eq!(output.status.code(), Some(1), "timeout {timeout:?}");
        assert_eq!(
            error_of(&output)["error"]["code"],
            "board_unavailable",
            "timeout {timeout:?}"
        );
    }
}

#[test]
fn a_wait_without_a_running_server_is_board_unavailable() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let after = snapshot(home.path(), "Alpha")["cursor"]
        .as_str()
        .unwrap()
        .to_string();
    let output = finish(
        spawn_wait(home.path(), "Alpha", &after, None),
        Duration::from_secs(10),
    );
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(error_of(&output)["error"]["code"], "board_unavailable");
}

#[cfg(unix)]
#[test]
fn interrupting_a_wait_stops_it_and_changes_nothing() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let before = snapshot(home.path(), "Alpha");
    let after = before["cursor"].as_str().unwrap().to_string();
    let server = start_server(home.path());
    let mut waiter = spawn_wait(home.path(), "Alpha", &after, None);
    assert!(still_running(&mut waiter, Duration::from_millis(700)));
    let status = Command::new("kill")
        .args(["-INT", &waiter.id().to_string()])
        .status()
        .unwrap();
    assert!(status.success());
    let output = finish(waiter, Duration::from_secs(10));
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(content(before), content(snapshot(home.path(), "Alpha")));
    stop(server);
}

#[test]
fn consecutive_changes_return_the_latest_snapshot() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let alpha = snapshot(home.path(), "Alpha");
    let after = alpha["cursor"].as_str().unwrap().to_string();
    let server = start_server(home.path());
    let waiter = spawn_wait(home.path(), "Alpha", &after, None);
    std::thread::sleep(Duration::from_millis(500));
    add_task(home.path(), "Alpha", "First change");
    add_task(home.path(), "Alpha", "Second change");
    let output = finish(waiter, Duration::from_secs(10));
    ok(&output);
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_ne!(result["version"], alpha["version"]);
    // Whatever it returns is a complete, current snapshot of Alpha.
    let latest = snapshot(home.path(), "Alpha");
    let tasks = result["tasks"].as_array().unwrap();
    assert!(tasks.len() >= 2 && tasks.len() <= latest["tasks"].as_array().unwrap().len());
    stop(server);
}
