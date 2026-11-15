//! `agboard remote`: the ngrok connection state, the public address with the
//! project, and the passcode, read from a real server on loopback.
//!
//! No test connects to ngrok: the tunnel is opened by a fake connector.

#[path = "support/mobile_monitor.rs"]
mod support;

use std::path::Path;
use std::process::Output;

use assert_cmd::Command;
use serde_json::{Value, json};
use support::home;

#[path = "support/ngrok_harness.rs"]
mod harness;
use harness::*;

fn agboard(home: &Path, args: &[&str]) -> Output {
    let mut cmd = Command::cargo_bin("agboard").unwrap();
    cmd.env("AGBOARD_AUTOSTART", "0")
        .env("AGBOARD_OPEN_BROWSER", "0")
        .env("AGBOARD_WATCH", "poll")
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .env_remove("NGROK_AUTHTOKEN")
        .current_dir(home)
        .args(args);
    cmd.output().unwrap()
}

fn out(o: &Output) -> String {
    String::from_utf8_lossy(&o.stdout).into_owned()
}

fn err(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

fn project_id(home: &Path) -> String {
    let listed = agboard(home, &["--json", "project", "ls"]);
    let v: Value = serde_json::from_slice(&listed.stdout).unwrap();
    v["projects"][0]["id"].as_str().unwrap().to_string()
}

fn connect(s: &Server) {
    assert_eq!(s.put(true, 0).status, 200);
    assert_eq!(s.start_ngrok(json!({"token": TOKEN})).status, 202);
    s.wait_status("ready");
}

#[test]
fn ready_connection_prints_the_state_the_project_address_and_the_passcode() {
    let home = home();
    let s = Server::start(home.path(), Opts::default());
    connect(&s);
    let passcode = s.passcode();
    let id = project_id(home.path());

    let text = agboard(home.path(), &["--project", "monitor", "remote"]);
    assert!(text.status.success(), "{}", err(&text));
    assert_eq!(
        out(&text),
        format!(
            "ngrok: ready\nURL: {PUBLIC}/?project={id}\nPasscode: {passcode}\nProject: monitor\n"
        )
    );

    let json = agboard(home.path(), &["--json", "--project", "monitor", "remote"]);
    assert!(json.status.success(), "{}", err(&json));
    let v: Value = serde_json::from_slice(&json.stdout).unwrap();
    assert_eq!(
        v,
        json!({
            "status": "ready",
            "url": format!("{PUBLIC}/?project={id}"),
            "entrance": PUBLIC,
            "passcode": passcode,
            "project": {"id": id, "name": "monitor"},
        })
    );
    // The token never appears.
    assert!(!out(&json).contains(TOKEN));
}

#[test]
fn without_project_it_is_a_usage_error_and_prints_no_address_or_passcode() {
    let home = home();
    let s = Server::start(home.path(), Opts::default());
    connect(&s);
    let passcode = s.passcode();

    let run = agboard(home.path(), &["--json", "remote"]);
    assert_eq!(run.status.code(), Some(2), "{}", err(&run));
    assert!(out(&run).is_empty(), "{}", out(&run));
    let v: Value = serde_json::from_str(&err(&run)).unwrap();
    assert_eq!(v["error"]["code"], "invalid_argument");
    assert!(!err(&run).contains(PUBLIC) && !err(&run).contains(&passcode));
}

#[test]
fn an_unknown_project_is_an_error_not_the_entrance() {
    let home = home();
    let s = Server::start(home.path(), Opts::default());
    connect(&s);
    let run = agboard(home.path(), &["--project", "nope", "remote"]);
    assert_eq!(run.status.code(), Some(4), "{}", err(&run));
    assert!(!out(&run).contains(PUBLIC));
}

#[test]
fn without_a_running_server_it_fails_and_prints_no_address_or_passcode() {
    let home = home();
    for json in [false, true] {
        let mut args = vec!["--project", "monitor", "remote"];
        if json {
            args.insert(0, "--json");
        }
        let run = agboard(home.path(), &args);
        assert_eq!(run.status.code(), Some(1));
        assert_eq!(out(&run), "");
        let e = err(&run);
        assert!(e.contains("No server is running"), "{e}");
    }
}

#[test]
fn a_connection_that_is_not_ready_fails_and_prints_no_address_or_passcode() {
    let home = home();
    let s = Server::start(home.path(), Opts::default());
    // Not turned on yet.
    let run = agboard(home.path(), &["--json", "--project", "monitor", "remote"]);
    assert_eq!(run.status.code(), Some(1));
    assert_eq!(out(&run), "");
    let e: Value = serde_json::from_str(err(&run).trim()).unwrap();
    assert_eq!(e["error"]["code"], "remote_unavailable");
    assert!(e["error"]["reason"].as_str().unwrap().contains("not ready"));
    assert!(!err(&run).contains(PUBLIC));

    // A connection that failed to start.
    *s.fake.fail.lock().unwrap() = true;
    assert_eq!(s.put(true, 0).status, 200);
    assert_eq!(s.start_ngrok(json!({"token": TOKEN})).status, 202);
    s.wait_status("failed");
    let run = agboard(home.path(), &["--project", "monitor", "remote"]);
    assert_eq!(run.status.code(), Some(1));
    assert_eq!(out(&run), "");
    assert!(err(&run).contains("connect_failed"), "{}", err(&run));
    assert!(!err(&run).contains(TOKEN));
}
