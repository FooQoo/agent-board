//! A real ngrok entrance backend on loopback for the browser tests.
//!
//! Run only by `e2e/helpers/phone-entrance.mjs`, which starts this test with
//! `--ignored`, reads the line that starts with `READY`, and sends commands on
//! stdin. No test here reaches ngrok: a mock connector opens the "tunnel", so
//! the Edge (adding the public Host, header removal) is not exercised. The READY line
//! carries the passcode of the start, as the PC would show it.
//!
//! The Playwright specs stand in for the Edge with a small proxy. Those specs set
//! `AGBOARD_PHONE_HOME` to serve a data area they filled through the CLI; the
//! decision request below is then left to them. The data area may already hold
//! the saved setting of an earlier run.

#![allow(dead_code)]

#[path = "support/qa.rs"]
mod qa;
#[path = "support/mobile_monitor.rs"]
mod support;

#[path = "support/ngrok_harness.rs"]
mod harness;

use std::io::BufRead;

use agent_board::file_store::FileStore;
use harness::*;
use serde_json::json;
use support::home;

fn announce(s: &Server) {
    let passcode = s.passcode();
    let calls = s.mock.calls.lock().unwrap();
    let call = calls.last().unwrap();
    println!(
        "READY {}",
        json!({
            "addr": backend_addr(call).to_string(),
            "passcode": passcode,
            "host": PUBLIC.trim_start_matches("https://"),
            "origin": PUBLIC,
            "local": s.local.to_string(),
        })
    );
}

/// Commands on stdin: `rotate` replaces the tunnel (old sessions end and the
/// passcode changes), `stop` stops it, `quit` ends the test.
#[test]
#[ignore = "started by e2e/helpers/phone-entrance.mjs"]
fn serve_the_phone_backend_until_told_to_quit() {
    let external = std::env::var_os("AGBOARD_PHONE_HOME").map(std::path::PathBuf::from);
    let temp = external.is_none().then(home);
    let path = external
        .clone()
        .unwrap_or_else(|| temp.as_ref().unwrap().path().to_path_buf());
    if temp.is_some() {
        let store = FileStore::open(&path.join("shared"));
        let project = store.project_by_name("monitor").unwrap().id;
        qa::ask(
            &store,
            &project,
            &[1],
            "Choose the first path",
            &[("keep", "Keep"), ("reset", "Reset")],
        );
        println!("PROJECT {project}");
    }
    let s = Server::start(
        &path,
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    // A saved, enabled setting is restored by the start itself.
    let status = s.get()["status"].clone();
    if status != "ready" && status != "starting" {
        let revision = s.get()["revision"].as_u64().unwrap();
        assert_eq!(s.put(true, revision).status, 200);
        assert_eq!(s.start_ngrok(json!({})).status, 202);
    }
    s.wait_status("ready");
    println!("LOCAL http://{}", s.local);
    announce(&s);
    for line in std::io::stdin().lock().lines() {
        match line.unwrap().trim() {
            "rotate" => {
                // A new start is a new tunnel, which is a new passcode.
                let before = s.mock.opens.load(std::sync::atomic::Ordering::SeqCst);
                assert_eq!(s.start_ngrok(json!({})).status, 202);
                let end = std::time::Instant::now() + std::time::Duration::from_secs(5);
                while s.mock.opens.load(std::sync::atomic::Ordering::SeqCst) <= before {
                    assert!(std::time::Instant::now() < end);
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                s.wait_status("ready");
                announce(&s);
            }
            "stop" => {
                s.stop_ngrok();
                println!("STOPPED");
            }
            "quit" => break,
            _ => {}
        }
    }
}
