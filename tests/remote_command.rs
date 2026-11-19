//! `agboard show remote`: the saved settings, the ngrok connection state, the public address with the
//! project, and the passcode, read from a real server on loopback.
//!
//! No test connects to ngrok: the tunnel is opened by a mock connector.

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
        .env("AGBOARD_KEYCHAIN", "none")
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

    let text = agboard(home.path(), &["--project", "monitor", "show", "remote"]);
    assert!(text.status.success(), "{}", err(&text));
    assert_eq!(
        out(&text),
        format!(
            "ngrok: ready\nURL: {PUBLIC}/?project={id}\nPasscode: {passcode}\nProject: monitor\nEnabled: yes\nDomain: none (ngrok chooses an address at each start)\nToken: not saved (the keychain is not available here)\n"
        )
    );

    let json = agboard(
        home.path(),
        &["--json", "--project", "monitor", "show", "remote"],
    );
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
            "enabled": true,
            "domain": null,
            "tokenSaved": false,
            "keychainAvailable": false,
        })
    );
    // The token never appears.
    assert!(!out(&json).contains(TOKEN));
}

#[test]
fn without_a_project_it_reports_the_settings_and_the_state_and_prints_no_passcode() {
    let home = home();
    let s = Server::start(home.path(), Opts::default());
    connect(&s);
    let passcode = s.passcode();

    let run = agboard(home.path(), &["--json", "show", "remote"]);
    assert_eq!(run.status.code(), Some(0), "{}", err(&run));
    let v: Value = serde_json::from_str(&out(&run)).unwrap();
    assert_eq!(v["status"], "ready");
    assert_eq!(v["entrance"], PUBLIC);
    assert_eq!(v["enabled"], true);
    assert_eq!(v["tokenSaved"], false);
    assert!(v.get("passcode").is_none() && v.get("url").is_none());
    assert!(!out(&run).contains(&passcode) && !out(&run).contains(TOKEN));

    let text = agboard(home.path(), &["show", "remote"]);
    assert!(
        out(&text).contains(&format!("Connection: ready at {PUBLIC}")),
        "{}",
        out(&text)
    );
    assert!(!out(&text).contains(&passcode));
}

#[test]
fn without_a_project_and_without_a_server_it_still_shows_the_saved_settings() {
    let home = home();
    let run = agboard(home.path(), &["--json", "show", "remote"]);
    assert_eq!(run.status.code(), Some(0), "{}", err(&run));
    let v: Value = serde_json::from_str(&out(&run)).unwrap();
    assert_eq!(v["status"], "no_server");
    assert_eq!(v["enabled"], false);
}

#[test]
fn the_old_remote_command_is_gone() {
    let home = home();
    let run = agboard(home.path(), &["--project", "monitor", "remote"]);
    assert_eq!(run.status.code(), Some(2), "{}", err(&run));
    assert!(out(&run).is_empty());
}

#[test]
fn an_unknown_project_is_an_error_not_the_entrance() {
    let home = home();
    let s = Server::start(home.path(), Opts::default());
    connect(&s);
    let run = agboard(home.path(), &["--project", "nope", "show", "remote"]);
    assert_eq!(run.status.code(), Some(4), "{}", err(&run));
    assert!(!out(&run).contains(PUBLIC));
}

#[test]
fn without_a_running_server_it_fails_and_prints_no_address_or_passcode() {
    let home = home();
    for json in [false, true] {
        let mut args = vec!["--project", "monitor", "show", "remote"];
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
    let run = agboard(
        home.path(),
        &["--json", "--project", "monitor", "show", "remote"],
    );
    assert_eq!(run.status.code(), Some(1));
    assert_eq!(out(&run), "");
    let e: Value = serde_json::from_str(err(&run).trim()).unwrap();
    assert_eq!(e["error"]["code"], "remote_unavailable");
    assert!(e["error"]["reason"].as_str().unwrap().contains("not ready"));
    assert!(!err(&run).contains(PUBLIC));

    // A connection that failed to start.
    *s.mock.fail.lock().unwrap() = true;
    assert_eq!(s.put(true, 0).status, 200);
    assert_eq!(s.start_ngrok(json!({"token": TOKEN})).status, 202);
    s.wait_status("failed");
    let run = agboard(home.path(), &["--project", "monitor", "show", "remote"]);
    assert_eq!(run.status.code(), Some(1));
    assert_eq!(out(&run), "");
    assert!(err(&run).contains("connect_failed"), "{}", err(&run));
    assert!(!err(&run).contains(TOKEN));
}
