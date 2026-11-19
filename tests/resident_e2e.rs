//! A resident session end to end, with a fake `claude` that behaves as the resident skill
//! tells a session to: it runs the real `agboard wait --until task` with the environment the
//! launcher sets, accepts every request it is handed, and waits again. The server runs on port 0
//! in a temporary data directory; nothing here needs a real agent CLI.
#![cfg(unix)]

mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::Value;
use tempfile::tempdir;

use common::{Running, agboard};

/// Poll `check` until it returns a value, or fail at the deadline.
fn until<T>(what: &str, mut check: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(found) = check() {
            return found;
        }
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn lines(path: &Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

/// The fake session. It records each start (its process ID), each wait result, and each request
/// it accepted in `log`.
fn fake_session(bin: &str, home: &Path, log: &Path) -> String {
    format!(
        r#"#!/bin/sh
case "$1" in
  auth) echo '{{"loggedIn":true}}'; exit 0 ;;
esac
export AGBOARD_HOME='{home}' AGBOARD_AUTOSTART=0 AGBOARD_OPEN_BROWSER=0 AGBOARD_WATCH=poll TZ=UTC
echo $$ >> '{log}/starts'
echo "$AGBOARD_SESSION_ORIGIN $AGBOARD_SESSION_TOOL" >> '{log}/env'
while :; do
  out=$('{bin}' --project Demo wait --until task --idle-timeout 2 --json 2>>'{log}/err')
  echo "$out" >> '{log}/waits'
  if echo "$out" | grep -q '"kind": *"requests"'; then
    for id in $(echo "$out" | grep -o 'Q-[0-9]*' | sort -u); do
      '{bin}' --project Demo message accept "$id" --actor ai >/dev/null && echo "$id" >> '{log}/accepted'
    done
  fi
  sleep 0.1
done
"#,
        home = home.display(),
        log = log.display(),
    )
}

fn sessions(server: &Running, base: &str) -> Value {
    server.get(base).json()
}

#[test]
fn a_launched_session_accepts_a_request_waits_again_is_restarted_and_stops() {
    let tools = tempdir().unwrap();
    let home = tempdir().unwrap();
    let log = tempdir().unwrap();
    let claude = tools.path().join("claude");
    std::fs::write(
        &claude,
        fake_session(env!("CARGO_BIN_EXE_agboard"), home.path(), log.path()),
    )
    .unwrap();
    std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).unwrap();
    // SAFETY: set before the only server of this test binary starts.
    unsafe {
        std::env::set_var("AGBOARD_CLAUDE_BIN", &claude);
        std::env::set_var("AGBOARD_SESSION_GRACE_MS", "5000");
    }

    // A project with no task, so the only work the session meets is the request below.
    let (code, _, err) = agboard(home.path(), &["project", "create", "Demo"]);
    assert_eq!(code, 0, "{err}");
    let server = Running::start(home.path());
    let id = server.get("/api/projects").json()["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let base = format!("/api/projects/{id}/sessions");

    // Launch: the session attaches and its wait is registered.
    let launched = server.write(
        "POST",
        &format!("{base}/launch"),
        Some(r#"{"tool":"claude-code"}"#),
    );
    assert_eq!(launched.status, 200, "{}", launched.body);
    let attached = until("the session to attach", || {
        let body = sessions(&server, &base);
        (body["counts"]["byOrigin"]["board"] == 1 && body["health"]["waiting"] == true)
            .then_some(body)
    });
    assert_eq!(attached["sessions"][0]["origin"], "board");
    assert_eq!(attached["sessions"][0]["tool"], "claude-code");
    assert_eq!(attached["health"]["state"], "running");
    assert_eq!(lines(&log.path().join("env")), ["board claude-code"]);

    // A request made on the board is accepted by the session with no human action.
    let (code, out, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "send",
            "--actor",
            "human",
            "--text",
            "Add a line to the README",
        ],
    );
    assert_eq!(code, 0, "{out}{err}");
    let accepted = until("the request to be accepted", || {
        let ids = lines(&log.path().join("accepted"));
        (!ids.is_empty()).then_some(ids)
    });
    assert_eq!(accepted, ["Q-1"]);
    until("the accepted request to leave the board's list", || {
        let summary = server.get(&format!("/api/projects/{id}/summary")).json();
        summary["messages"]
            .as_array()
            .unwrap()
            .is_empty()
            .then_some(())
    });

    // After the wait that returned the request, the session waits again, and an idle timeout
    // never ends it.
    let before = lines(&log.path().join("waits")).len();
    until(
        "two more waits to end and the session to wait again",
        || {
            let waits = lines(&log.path().join("waits"));
            let health = sessions(&server, &base)["health"].clone();
            (waits.len() >= before + 2 && health["waiting"] == true && health["state"] == "running")
                .then_some(())
        },
    );
    assert!(
        lines(&log.path().join("waits"))
            .iter()
            .any(|w| w.contains("idle_timeout"))
    );
    assert_eq!(lines(&log.path().join("starts")).len(), 1);

    // Killing the process makes the supervisor start it again, and it attaches again.
    let pid = lines(&log.path().join("starts"))[0].clone();
    let killed = std::process::Command::new("kill")
        .args(["-9", "--", &format!("-{pid}")])
        .status()
        .unwrap();
    assert!(killed.success());
    until("the session to be restarted and attach", || {
        let body = sessions(&server, &base);
        (lines(&log.path().join("starts")).len() == 2
            && body["health"]["state"] == "running"
            && body["health"]["restartCount"] == 1
            && body["health"]["waiting"] == true)
            .then_some(())
    });
    assert_eq!(sessions(&server, &base)["counts"]["byOrigin"]["board"], 1);

    // Stop removes it from the count, and nothing starts it again.
    let stopped = server.write("POST", &format!("{base}/stop"), Some("{}"));
    assert_eq!(stopped.json()["stopped"], true);
    let after = sessions(&server, &base);
    assert_eq!(after["counts"]["total"], 0, "{after}");
    assert_eq!(after["health"]["state"], "stopped");
    std::thread::sleep(Duration::from_millis(2500));
    assert_eq!(lines(&log.path().join("starts")).len(), 2);
    assert_eq!(sessions(&server, &base)["counts"]["total"], 0);
    server.stop();
}
