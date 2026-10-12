//! A running server that is too busy to answer its health check is still
//! serving: a second `serve` on the same data area is refused and leaves
//! `serve.json` as it was.

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn bin(home: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_agboard"));
    command.env("AGBOARD_HOME", home).env("TZ", "UTC");
    command
}

fn wait_for_serve_json(home: &Path) -> String {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Ok(text) = std::fs::read_to_string(home.join("serve.json")) {
            return text;
        }
        assert!(Instant::now() < deadline, "serve.json was not written");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn a_frozen_server_still_refuses_a_second_serve_and_keeps_its_record() {
    let home = tempfile::tempdir().unwrap();
    assert!(
        bin(home.path())
            .args(["project", "create", "Demo"])
            .output()
            .unwrap()
            .status
            .success()
    );
    let mut first = bin(home.path())
        .args(["serve", "--port", "0"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let record = wait_for_serve_json(home.path());
    let pid = first.id() as libc::pid_t;

    // SAFETY: the signals go to the server this test started.
    unsafe { libc::kill(pid, libc::SIGSTOP) };
    let second = bin(home.path())
        .args(["serve", "--port", "0"])
        .output()
        .unwrap();
    unsafe { libc::kill(pid, libc::SIGCONT) };
    let _ = first.kill();
    let _ = first.wait();

    assert!(!second.status.success());
    let stderr = String::from_utf8_lossy(&second.stderr);
    assert!(stderr.contains("already being served"), "{stderr}");
    assert_eq!(
        std::fs::read_to_string(home.path().join("serve.json")).unwrap_or_default(),
        record
    );
}

#[test]
fn a_saved_change_says_when_the_recorded_server_is_gone() {
    let home = tempfile::tempdir().unwrap();
    assert!(
        bin(home.path())
            .args(["project", "create", "Demo"])
            .output()
            .unwrap()
            .status
            .success()
    );
    // A record of a server that is gone: no process has this pid, and nothing listens on port 1.
    std::fs::write(
        home.path().join("serve.json"),
        r#"{"pid":999999,"port":1,"started_at":"2026-10-12T00:00:00Z"}"#,
    )
    .unwrap();
    let added = bin(home.path())
        .args([
            "--project",
            "Demo",
            "add",
            "Saved anyway",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ])
        .output()
        .unwrap();
    assert!(
        added.status.success(),
        "{}",
        String::from_utf8_lossy(&added.stderr)
    );
    let stderr = String::from_utf8_lossy(&added.stderr);
    assert!(
        stderr.contains("serve.json") && stderr.contains("agboard serve"),
        "{stderr}"
    );
    let listed = bin(home.path())
        .args(["--project", "Demo", "ls", "--json"])
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&listed.stdout).contains("Saved anyway"));
}
