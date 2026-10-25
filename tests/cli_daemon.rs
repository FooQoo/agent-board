//! `agboard serve -d` and `agboard stop`.
//!
//! These tests run the real binary with `AGBOARD_HOME` in a temporary
//! directory. They use only port 7971 (never 7420) and run one at a time.
//! A guard stops any background server a test leaves behind.

use std::net::{Ipv4Addr, TcpListener};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use assert_cmd::Command;

static SERIAL: Mutex<()> = Mutex::new(());

const PORT: &str = "7971";

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn agboard(home: &Path) -> Command {
    let mut cmd = Command::cargo_bin("agboard").unwrap();
    cmd.env("AGBOARD_HOME", home).env("TZ", "UTC");
    cmd
}

/// Stops the background server of `home` when a test ends, even by panic.
struct Cleanup<'a>(&'a Path);

impl Drop for Cleanup<'_> {
    fn drop(&mut self) {
        let _ = agboard(self.0).arg("stop").output();
    }
}

fn port_is_free() -> bool {
    TcpListener::bind((Ipv4Addr::LOCALHOST, PORT.parse().unwrap())).is_ok()
}

fn stdout(output: &std::process::Output) -> String {
    String::from_utf8(output.stdout.clone()).unwrap()
}

#[test]
fn serve_d_returns_while_the_server_runs_and_stop_ends_it() {
    let _serial = serial();
    let home = tempfile::tempdir().unwrap();
    let _cleanup = Cleanup(home.path());

    let started = agboard(home.path())
        .args(["serve", "-d", "--port", PORT])
        .output()
        .unwrap();
    assert!(started.status.success(), "{started:?}");
    let line = stdout(&started);
    assert!(
        line.starts_with(&format!(
            "Serving at http://127.0.0.1:{PORT}/ in the background"
        )),
        "{line}"
    );
    assert!(line.contains("agboard stop"), "{line}");
    assert!(!port_is_free(), "the server should hold the port");

    let info: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(home.path().join("serve.json")).unwrap())
            .unwrap();
    assert_eq!(info["port"], PORT.parse::<u16>().unwrap());

    let again = agboard(home.path())
        .args(["serve", "-d", "--port", PORT])
        .output()
        .unwrap();
    assert_eq!(again.status.code(), Some(1), "{again:?}");
    assert!(
        String::from_utf8_lossy(&again.stderr).contains("already"),
        "{again:?}"
    );

    let stopped = agboard(home.path()).arg("stop").output().unwrap();
    assert!(stopped.status.success(), "{stopped:?}");
    assert_eq!(
        stdout(&stopped),
        format!("Stopped the server on port {PORT}.\n")
    );
    assert!(port_is_free(), "stop should release the port");
    assert!(!home.path().join("serve.json").exists());
}

#[test]
fn serve_d_with_json_adds_the_process_and_the_log() {
    let _serial = serial();
    let home = tempfile::tempdir().unwrap();
    let _cleanup = Cleanup(home.path());

    let started = agboard(home.path())
        .args(["--json", "serve", "-d", "--port", PORT])
        .output()
        .unwrap();
    assert!(started.status.success(), "{started:?}");
    let value: serde_json::Value = serde_json::from_str(stdout(&started).trim()).unwrap();
    assert_eq!(value["url"], format!("http://127.0.0.1:{PORT}/"));
    assert!(value["pid"].as_u64().is_some());
    assert_eq!(
        value["log"],
        home.path().join("serve.log").display().to_string()
    );

    let stopped = agboard(home.path())
        .args(["--json", "stop"])
        .output()
        .unwrap();
    let value: serde_json::Value = serde_json::from_str(stdout(&stopped).trim()).unwrap();
    assert_eq!(value["stopped"], true);
    assert_eq!(value["port"], PORT.parse::<u16>().unwrap());
}

#[test]
fn a_port_in_use_fails_serve_d_with_the_reason() {
    let _serial = serial();
    let home = tempfile::tempdir().unwrap();
    let _cleanup = Cleanup(home.path());
    let _held = TcpListener::bind((Ipv4Addr::LOCALHOST, PORT.parse().unwrap())).unwrap();

    let started = agboard(home.path())
        .args(["serve", "-d", "--port", PORT])
        .output()
        .unwrap();
    assert!(!started.status.success(), "{started:?}");
    assert!(
        String::from_utf8_lossy(&started.stderr).contains("in use"),
        "{started:?}"
    );
}

#[test]
fn stop_without_a_server_reports_it_and_succeeds() {
    let _serial = serial();
    let home = tempfile::tempdir().unwrap();

    let stopped = agboard(home.path()).arg("stop").output().unwrap();
    assert!(stopped.status.success(), "{stopped:?}");
    assert_eq!(stdout(&stopped), "No server is running.\n");

    // A serve.json left by a crashed server names nothing that runs.
    std::fs::write(
        home.path().join("serve.json"),
        r#"{"pid":999999,"port":7971,"started_at":"2026-01-01T00:00:00Z"}"#,
    )
    .unwrap();
    let stopped = agboard(home.path())
        .args(["--json", "stop"])
        .output()
        .unwrap();
    assert!(stopped.status.success(), "{stopped:?}");
    assert_eq!(stdout(&stopped), "{\"stopped\":false}\n");
}

#[test]
fn stop_takes_no_project() {
    let home = tempfile::tempdir().unwrap();
    let output = agboard(home.path())
        .args(["--project", "demo", "stop"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2), "{output:?}");
}
