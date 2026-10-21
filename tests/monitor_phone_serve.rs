//! A real ngrok monitor backend on loopback for the phone client's own tests.
//!
//! Run only by `web/test/monitor/phone-live.test.ts`, which starts this test with
//! `--ignored`, reads the line that starts with `READY`, and sends commands on
//! stdin. No test here reaches ngrok: a fake connector opens the "tunnel", so
//! the Edge (Google sign-in, allow list, header removal) is not exercised.

#![allow(dead_code)]

#[path = "support/mobile_monitor.rs"]
mod support;

#[path = "support/ngrok_harness.rs"]
mod harness;

use std::io::BufRead;

use agent_board::domain::Actor;
use agent_board::file_store::FileStore;
use agent_board::file_store::model::Choice;
use harness::*;
use serde_json::{Value, json};
use support::home;

fn proof_of(policy: &str) -> String {
    serde_json::from_str::<Value>(policy).unwrap()["on_http_request"][3]["actions"][0]["config"]
        ["headers"]["x-agboard-tunnel-proof"]
        .as_str()
        .unwrap()
        .to_string()
}

fn announce(s: &Server) {
    let calls = s.fake.calls.lock().unwrap();
    let call = calls.last().unwrap();
    println!(
        "READY {}",
        json!({
            "addr": backend_addr(call).to_string(),
            "proof": proof_of(&call.policy),
            "host": PUBLIC.trim_start_matches("https://"),
            "origin": PUBLIC,
        })
    );
}

/// Commands on stdin: `rotate` replaces the tunnel (old sessions end), `stop`
/// stops it, `quit` ends the test.
#[test]
#[ignore = "started by web/test/monitor/phone-live.test.ts"]
fn serve_the_phone_backend_until_told_to_quit() {
    let home = home();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.project_by_name("monitor").unwrap().id;
    store
        .request_decision(
            &project,
            1,
            Actor::Ai,
            "Choose the first path",
            vec![
                Choice {
                    id: "keep".into(),
                    label: "Keep".into(),
                },
                Choice {
                    id: "reset".into(),
                    label: "Reset".into(),
                },
            ],
            chrono::Utc::now(),
        )
        .unwrap();
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    assert_eq!(s.put(true, &["owner@example.com"], 0).status, 200);
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    s.wait_status("ready");
    println!("PROJECT {project}");
    announce(&s);
    let mut revision = 1;
    for line in std::io::stdin().lock().lines() {
        match line.unwrap().trim() {
            "rotate" => {
                let email = format!("owner{revision}@example.com");
                let before = s.fake.opens.load(std::sync::atomic::Ordering::SeqCst);
                assert_eq!(s.put(true, &[&email], revision).status, 200);
                revision += 1;
                let end = std::time::Instant::now() + std::time::Duration::from_secs(5);
                while s.fake.opens.load(std::sync::atomic::Ordering::SeqCst) <= before {
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
