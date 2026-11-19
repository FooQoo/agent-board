//! The `codex app-server` conversation, without a process.

use std::path::PathBuf;

use serde_json::{Value, json};

use super::codex_parse::{Session, Settings, Step, thread_params};
use super::{DriverEvent, PermissionAnswer, PermissionKind, TurnOutcome};

fn settings(model: Option<&str>) -> Settings {
    Settings {
        cwd: PathBuf::from("/work"),
        model: model.map(str::to_string),
        writable_dirs: vec![PathBuf::from("/data")],
        version: "1.0.0".to_string(),
    }
}

/// A session past its handshake, with its first turn started: `turn-1` of `thread-1`.
fn running() -> Session {
    let mut session = Session::new(settings(None), "first");
    session.hello();
    session.on_line(r#"{"id":1,"result":{"userAgent":"agboard/0.170.0 (Mac)"}}"#);
    session.on_line(r#"{"id":2,"result":{"thread":{"id":"thread-1"}}}"#);
    session.on_line(r#"{"id":3,"result":{"turn":{"id":"turn-1"}}}"#);
    session.on_line(r#"{"method":"turn/started","params":{"turn":{"id":"turn-1"}}}"#);
    session
}

fn method_of(step: &Step, n: usize) -> &str {
    step.sends[n]["method"].as_str().unwrap()
}

#[test]
fn the_handshake_starts_a_thread_and_the_first_turn_and_reports_the_version() {
    let mut session = Session::new(settings(None), "do it");
    let hello = session.hello();
    assert_eq!(hello["method"], "initialize");
    assert_eq!(hello["params"]["clientInfo"]["name"], "agboard");
    assert_eq!(hello["params"]["capabilities"]["experimentalApi"], false);
    assert!(hello.get("jsonrpc").is_none());

    let step = session.on_line(r#"{"id":1,"result":{"userAgent":"agboard/0.170.0 (Mac OS)"}}"#);
    assert_eq!(step.sends.len(), 2);
    assert_eq!(step.sends[0], json!({"method": "initialized"}));
    assert_eq!(method_of(&step, 1), "thread/start");

    let step = session.on_line(r#"{"id":2,"result":{"thread":{"id":"thread-1"}}}"#);
    assert_eq!(
        step.events,
        [DriverEvent::Started {
            session_id: Some("thread-1".into()),
            tool_version: Some("0.170.0".into()),
        }]
    );
    assert_eq!(method_of(&step, 0), "turn/start");
    let params = &step.sends[0]["params"];
    assert_eq!(params["threadId"], "thread-1");
    assert_eq!(
        params["input"][0],
        json!({"type": "text", "text": "do it", "text_elements": []})
    );
    assert_eq!(step.busy, Some(true));
}

#[test]
fn a_thread_has_the_workspace_sandbox_automatic_review_and_the_writable_folders() {
    let params = thread_params(&settings(None));
    assert_eq!(params["cwd"], "/work");
    assert_eq!(params["sandbox"], "workspace-write");
    assert_eq!(params["approvalPolicy"], "on-request");
    assert_eq!(params["approvalsReviewer"], "auto_review");
    assert_eq!(
        params["config"],
        json!({"sandbox_workspace_write": {"writable_roots": ["/data"]}})
    );
    assert!(params.get("model").is_none());
    assert_eq!(thread_params(&settings(Some("gpt-a")))["model"], "gpt-a");
}

#[test]
fn a_failed_handshake_closes_the_input_so_that_the_session_ends() {
    let mut session = Session::new(settings(None), "x");
    session.hello();
    let step = session.on_line(r#"{"id":1,"error":{"code":-32600,"message":"bad"}}"#);
    assert!(step.close);
    assert!(step.notes[0].contains("bad"));
}

#[test]
fn an_approval_request_waits_for_an_answer_that_keeps_the_server_id() {
    let mut session = running();
    session.on_line(r#"{"method":"item/started","params":{"item":{"type":"fileChange","id":"f1","changes":[{"path":"/work/a.txt","diff":"+x"}]}}}"#);
    let step = session.on_line(
        r#"{"id":"srv-7","method":"item/fileChange/requestApproval","params":{"itemId":"f1"}}"#,
    );
    let [DriverEvent::PermissionRequest { id, kind, summary }] = step.events.as_slice() else {
        panic!("{:?}", step.events);
    };
    assert_eq!(*kind, PermissionKind::FileChange);
    assert_eq!(summary, "file change: /work/a.txt");
    assert!(step.sends.is_empty());
    let allow = session.answer(id, &PermissionAnswer::Allow).unwrap();
    assert_eq!(
        allow,
        json!({"id": "srv-7", "result": {"decision": "accept"}})
    );
    assert!(session.answer(id, &PermissionAnswer::Allow).is_none());

    let step = session.on_line(
        r#"{"id":8,"method":"item/commandExecution/requestApproval","params":{"command":"rm -rf x\nmore"}}"#,
    );
    let [DriverEvent::PermissionRequest { id, kind, summary }] = step.events.as_slice() else {
        panic!("{:?}", step.events);
    };
    assert_eq!(
        (*kind, summary.as_str()),
        (PermissionKind::Command, "command: rm -rf x")
    );
    let deny = PermissionAnswer::Deny {
        reason: "no".into(),
    };
    // A denial is a decline: the server has no field for the reason.
    assert_eq!(
        session.answer(id, &deny).unwrap(),
        json!({"id": 8, "result": {"decision": "decline"}})
    );
}

#[test]
fn a_request_of_an_unknown_kind_gets_a_method_not_found_error() {
    let mut session = running();
    let step = session.on_line(r#"{"id":5,"method":"item/tool/call","params":{}}"#);
    assert_eq!(step.events, [DriverEvent::Unknown]);
    assert_eq!(step.sends[0]["id"], 5);
    assert_eq!(step.sends[0]["error"]["code"], -32601);
}

#[test]
fn a_turn_ends_as_completed_interrupted_or_failed_and_the_session_is_idle() {
    let ended = |line: &str| {
        let mut session = running();
        let step = session.on_line(line);
        assert_eq!(step.busy, Some(false));
        match step.events.as_slice() {
            [DriverEvent::TurnEnded(outcome)] => outcome.clone(),
            other => panic!("{other:?}"),
        }
    };
    let done = |status: &str, error: &str| {
        format!(
            r#"{{"method":"turn/completed","params":{{"turn":{{"id":"turn-1","status":"{status}"{error}}}}}}}"#
        )
    };
    assert_eq!(ended(&done("completed", "")), TurnOutcome::Completed);
    assert_eq!(ended(&done("interrupted", "")), TurnOutcome::Interrupted);
    assert_eq!(
        ended(&done(
            "failed",
            r#","error":{"message":"401 Unauthorized\nx"}"#
        )),
        TurnOutcome::Failed {
            message: "401 Unauthorized".into()
        }
    );
}

#[test]
fn interrupt_names_the_thread_and_the_running_turn() {
    let mut session = running();
    let step = session.interrupt();
    assert_eq!(method_of(&step, 0), "turn/interrupt");
    assert_eq!(
        step.sends[0]["params"],
        json!({"threadId": "thread-1", "turnId": "turn-1"})
    );
    session.on_line(r#"{"method":"turn/completed","params":{"turn":{"status":"completed"}}}"#);
    assert!(session.interrupt().sends.is_empty());
}

#[test]
fn a_message_while_a_turn_runs_steers_it_and_one_that_is_refused_waits_for_the_turn_to_end() {
    let mut session = running();
    let step = session.user_message("more");
    assert_eq!(method_of(&step, 0), "turn/steer");
    assert_eq!(step.sends[0]["params"]["expectedTurnId"], "turn-1");
    assert_eq!(step.sends[0]["params"]["input"][0]["text"], "more");
    let id = step.sends[0]["id"].as_u64().unwrap();

    let refused = format!(r#"{{"id":{id},"error":{{"code":-32000,"message":"no active turn"}}}}"#);
    let step = session.on_line(&refused);
    assert!(step.sends.is_empty());
    let step =
        session.on_line(r#"{"method":"turn/completed","params":{"turn":{"status":"completed"}}}"#);
    assert_eq!(method_of(&step, 0), "turn/start");
    assert_eq!(step.sends[0]["params"]["input"][0]["text"], "more");
    assert_eq!(step.busy, Some(true));
}

#[test]
fn a_message_before_the_turn_is_known_is_queued_and_an_idle_session_starts_a_turn() {
    let mut session = Session::new(settings(None), "first");
    session.hello();
    assert!(session.user_message("early").sends.is_empty());
    session.on_line(r#"{"id":1,"result":{}}"#);
    let step = session.on_line(r#"{"id":2,"result":{"thread":{"id":"t"}}}"#);
    // Everything queued goes out as one turn.
    assert_eq!(
        step.sends[0]["params"]["input"][0]["text"],
        "first\n\nearly"
    );

    session.on_line(r#"{"id":3,"result":{"turn":{"id":"u"}}}"#);
    session.on_line(r#"{"method":"turn/completed","params":{"turn":{"status":"completed"}}}"#);
    let step = session.user_message("later");
    assert_eq!(method_of(&step, 0), "turn/start");
}

#[test]
fn items_become_activity_and_noise_and_unknown_messages_are_told_apart() {
    let mut session = running();
    let events = |session: &mut Session, line: &str| session.on_line(line).events;
    assert_eq!(
        events(
            &mut session,
            r#"{"method":"item/started","params":{"item":{"type":"commandExecution","id":"c","command":"ls -la"}}}"#
        ),
        [DriverEvent::Activity {
            kind: "command".into(),
            summary: "command: ls -la".into()
        }]
    );
    assert_eq!(
        events(
            &mut session,
            r#"{"method":"item/completed","params":{"item":{"type":"agentMessage","id":"m","text":"Done."}}}"#
        ),
        [DriverEvent::Activity {
            kind: "text".into(),
            summary: "Done.".into()
        }]
    );
    for noise in [
        r#"{"method":"hook/started","params":{}}"#,
        r#"{"method":"mcpServer/startupStatus/updated","params":{}}"#,
        r#"{"method":"thread/tokenUsage/updated","params":{}}"#,
        r#"{"method":"item/agentMessage/delta","params":{}}"#,
        r#"{"method":"warning","params":{}}"#,
    ] {
        assert!(events(&mut session, noise).is_empty(), "{noise}");
    }
    let error = events(
        &mut session,
        r#"{"method":"error","params":{"error":{"message":"401"}}}"#,
    );
    assert_eq!(
        error,
        [DriverEvent::Activity {
            kind: "error".into(),
            summary: "401".into()
        }]
    );
    assert_eq!(
        events(&mut session, r#"{"method":"brand/new"}"#),
        [DriverEvent::Unknown]
    );
    assert_eq!(events(&mut session, "not json"), [DriverEvent::Unknown]);
    // A response to a request nobody sent is unknown too.
    let stray: Value = json!({"id": 99, "result": {}});
    assert_eq!(
        events(&mut session, &stray.to_string()),
        [DriverEvent::Unknown]
    );
}
