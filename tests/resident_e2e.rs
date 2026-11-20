//! A resident agent end to end, with a fake `claude` or `codex` that behaves as the resident skill
//! tells a session the board launched to: it never runs `wait`, takes the message the board pushes
//! when it is idle, acts on it with the real `agboard` commands, and ends the turn. The server runs on port 0
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

/// The fake session as a shell script. It behaves as the resident skill tells a session the
/// board launched to behave: it never runs `wait`. The board sends it one message per turn; the
/// session records the message, does what the message asks (accepts each request, asks a
/// question when a request says "Ask me", accepts each answer), and ends the turn.
fn fake_session(tool: &str, bin: &str, home: &Path, log: &Path) -> String {
    let (setup, run) = if tool == "codex" {
        (
            "turn=0",
            r#"while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/^{"id":\([0-9][0-9]*\),.*/\1/p')
  case "$line" in
    *'"method":"initialize"'*) printf '{"id":%s,"result":{"userAgent":"agboard/9.9.9 (fake)"}}\n' "$id" ;;
    *'"method":"thread/start"'*) printf '{"id":%s,"result":{"thread":{"id":"e2e-fake"}}}\n' "$id" ;;
    *'"method":"turn/start"'*)
      turn=$((turn+1))
      printf '{"id":%s,"result":{"turn":{"id":"turn-%s"}}}\n' "$id" "$turn"
      printf '{"method":"turn/started","params":{"turn":{"id":"turn-%s"}}}\n' "$turn"
      handle "$line"
      printf '{"method":"turn/completed","params":{"turn":{"id":"turn-%s","status":"completed"}}}\n' "$turn" ;;
  esac
done
"#,
        )
    } else {
        (
            ":",
            r#"while IFS= read -r line; do
  echo '{"type":"system","subtype":"init","session_id":"e2e-fake","claude_code_version":"9.9.9"}'
  handle "$line"
  echo '{"type":"result","subtype":"success","is_error":false,"result":"done"}'
done
"#,
        )
    };
    format!(
        r#"#!/bin/sh
case "$1" in
  auth|login) echo '{{"loggedIn":true}}'; exit 0 ;;
esac
export AGBOARD_HOME='{home}' AGBOARD_AUTOSTART=0 AGBOARD_OPEN_BROWSER=0 AGBOARD_WATCH=poll TZ=UTC
LOG='{log}'
echo $$ >> '{log}/starts'
echo "$AGBOARD_SESSION_ORIGIN $AGBOARD_SESSION_TOOL" >> '{log}/env'
{setup}
handle() {{
  printf '%s\n' "$1" >> "$LOG/pushed"
  ids=$(printf '%s' "$1" | grep -o 'Q-[0-9]*' | sort -u)
  case "$1" in
    *requests*)
      for id in $ids; do
        '{bin}' --project Demo message accept "$id" --actor ai >/dev/null && echo "$id" >> "$LOG/accepted"
      done
      case "$1" in
        *'Ask me'*) '{bin}' --project Demo message ask --actor ai --no-wait --questions-json '{{"questions":[{{"body":"Which one?"}}]}}' >> "$LOG/asked" ;;
      esac ;;
    *answers*)
      for id in $ids; do
        '{bin}' --project Demo message accept "$id" --actor ai >/dev/null && echo "$id" >> "$LOG/answered"
      done ;;
  esac
}}
{run}"#,
        home = home.display(),
        log = log.display(),
        bin = bin,
        setup = setup,
        run = run,
    )
}

fn sessions(server: &Running, base: &str) -> Value {
    server.get(base).json()
}

/// Both tools in turn, in one test, because each run sets the executable of its tool in the
/// process environment before its server starts.
#[test]
fn a_launched_session_is_pushed_work_is_restarted_and_stops() {
    scenario("claude-code", "claude", "AGBOARD_CLAUDE_BIN");
    scenario("codex", "codex", "AGBOARD_CODEX_BIN");
}

fn scenario(tool: &str, program: &str, bin_var: &str) {
    let tools = tempdir().unwrap();
    let home = tempdir().unwrap();
    let log = tempdir().unwrap();
    let fake = tools.path().join(program);
    std::fs::write(
        &fake,
        fake_session(
            program,
            env!("CARGO_BIN_EXE_agboard"),
            home.path(),
            log.path(),
        ),
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    // SAFETY: set before the server of this run starts, and runs of this test binary are serial.
    unsafe {
        std::env::set_var(bin_var, &fake);
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

    // Launch: the session starts, its first turn (the launch prompt) ends, and the board counts
    // it as waiting without any `wait` from the session.
    let launched = server.write(
        "POST",
        &format!("{base}/launch"),
        Some(&format!(r#"{{"tool":"{tool}"}}"#)),
    );
    assert_eq!(launched.status, 200, "{}", launched.body);
    let attached = until("the session to attach", || {
        let body = sessions(&server, &base);
        (body["counts"]["byOrigin"]["board"] == 1 && body["health"]["waiting"] == true)
            .then_some(body)
    });
    assert_eq!(attached["sessions"][0]["origin"], "board");
    assert_eq!(attached["sessions"][0]["tool"], tool);
    assert_eq!(attached["sessions"][0]["state"], "connected");
    assert_eq!(attached["health"]["state"], "running");
    assert_eq!(lines(&log.path().join("env")), [format!("board {tool}")]);
    // The first instruction arrived in the tool's own protocol: a stream-json user message for
    // Claude Code, the first turn of the thread for Codex.
    let prompts = lines(&log.path().join("pushed"));
    assert_eq!(prompts.len(), 1);
    let first: Value = serde_json::from_str(&prompts[0]).unwrap();
    let text = if tool == "codex" {
        assert_eq!(first["method"], "turn/start");
        &first["params"]["input"][0]["text"]
    } else {
        assert_eq!(first["type"], "user");
        &first["message"]["content"]
    };
    let text = text.as_str().unwrap();
    assert!(text.contains("agboard skills resident"));
    assert!(text.contains("Do not run `agboard wait`"), "{text}");

    // An external session still attaches with `wait` and is counted next to the board's own.
    let mut external = std::process::Command::new(env!("CARGO_BIN_EXE_agboard"))
        .args([
            "--project",
            "Demo",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "60",
        ])
        .env("AGBOARD_HOME", home.path())
        .env("AGBOARD_AUTOSTART", "0")
        .env("AGBOARD_WATCH", "poll")
        .env("TZ", "UTC")
        .env_remove("AGBOARD_RESIDENT_ID")
        .env_remove("AGBOARD_SESSION_ORIGIN")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let both = until(
        "the external wait to be counted beside the board session",
        || {
            let body = sessions(&server, &base);
            (body["counts"]["byOrigin"]["external"] == 1
                && body["counts"]["byOrigin"]["board"] == 1)
                .then_some(body)
        },
    );
    assert_eq!(both["counts"]["total"], 2);
    let _ = external.kill();
    let _ = external.wait();

    // A request made on the board is pushed to the idle session, which accepts it with no
    // human action.
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
    until("the session to be idle again", || {
        (sessions(&server, &base)["health"]["waiting"] == true).then_some(())
    });

    // A question the session asks carries its launch ID, and the person's answer is pushed back
    // to it.
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
            "Ask me which one",
        ],
    );
    assert_eq!(code, 0, "{out}{err}");
    until("the session to ask", || {
        (!lines(&log.path().join("asked")).is_empty()).then_some(())
    });
    until("the session to be idle again", || {
        (sessions(&server, &base)["health"]["waiting"] == true).then_some(())
    });
    let (code, out, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "answer",
            "Q-3",
            "--actor",
            "human",
            "--via",
            "cli",
            "--text",
            "The first one",
        ],
    );
    assert_eq!(code, 0, "{out}{err}");
    let answered = until("the answer to be pushed and taken in", || {
        let ids = lines(&log.path().join("answered"));
        (!ids.is_empty()).then_some(ids)
    });
    assert_eq!(answered, ["Q-3"]);

    // The session never ran `wait`, and the board's own session shows as idle and waiting.
    assert!(
        !log.path().join("waits").exists(),
        "a board-launched session must not wait"
    );
    let health = until("the session to be waiting", || {
        let health = sessions(&server, &base)["health"].clone();
        (health["waiting"] == true).then_some(health)
    });
    assert_eq!(health["state"], "running");
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
    // The external session killed above may still be in its grace period; the board's is gone.
    assert_eq!(after["counts"]["byOrigin"]["board"], 0, "{after}");
    assert_eq!(after["health"]["state"], "stopped");
    std::thread::sleep(Duration::from_millis(2500));
    assert_eq!(lines(&log.path().join("starts")).len(), 2);
    assert_eq!(sessions(&server, &base)["counts"]["byOrigin"]["board"], 0);
    server.stop();
}
