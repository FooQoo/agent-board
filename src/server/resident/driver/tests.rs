//! The stream-json reader and the line cap, without a process.

use std::io::Cursor;

use serde_json::{Value, json};

use super::claude_parse::{Pending, parse_line};
use super::lines::{Line, for_each_line};
use super::{DriverEvent, PermissionKind, TurnOutcome};

fn parse(line: &str) -> (Vec<DriverEvent>, Option<Value>) {
    let parsed = parse_line(line, &mut Pending::new());
    (parsed.events, parsed.reply)
}

#[test]
fn init_gives_the_session_and_the_tool_version() {
    let (events, reply) = parse(
        r#"{"type":"system","subtype":"init","session_id":"s1","claude_code_version":"2.1.327","extra":{"a":1}}"#,
    );
    assert_eq!(
        events,
        [DriverEvent::Started {
            session_id: Some("s1".into()),
            tool_version: Some("2.1.327".into()),
        }]
    );
    assert!(reply.is_none());
}

#[test]
fn a_result_ends_a_turn_as_completed_interrupted_or_failed() {
    let ended = |line: &str| match parse(line).0.as_slice() {
        [DriverEvent::TurnEnded(outcome)] => outcome.clone(),
        other => panic!("{other:?}"),
    };
    assert_eq!(
        ended(r#"{"type":"result","subtype":"success","is_error":false,"result":"ok"}"#),
        TurnOutcome::Completed
    );
    assert_eq!(
        ended(
            r#"{"type":"result","subtype":"error_during_execution","is_error":true,"result":"boom\nmore"}"#
        ),
        TurnOutcome::Failed {
            message: "boom".into()
        }
    );
    assert_eq!(
        ended(r#"{"type":"result","subtype":"interrupted"}"#),
        TurnOutcome::Interrupted
    );
}

#[test]
fn assistant_blocks_become_activity() {
    let (events, _) = parse(
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"},{"type":"tool_use","name":"Bash","input":{"command":"ls -la"}}]}}"#,
    );
    assert_eq!(
        events,
        [
            DriverEvent::Activity {
                kind: "text".into(),
                summary: "Hello".into()
            },
            DriverEvent::Activity {
                kind: "tool_use".into(),
                summary: "Bash: ls -la".into()
            },
        ]
    );
}

#[test]
fn a_permission_request_is_kept_until_answered_and_an_unknown_request_gets_an_error() {
    let mut pending = Pending::new();
    let parsed = parse_line(
        r#"{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Write","input":{"file_path":"/x","content":"hi"},"tool_use_id":"t"}}"#,
        &mut pending,
    );
    assert_eq!(
        parsed.events,
        [DriverEvent::PermissionRequest {
            id: "r1".into(),
            kind: PermissionKind::FileChange,
            summary: "Write: /x".into(),
        }]
    );
    assert_eq!(pending["r1"], json!({"file_path": "/x", "content": "hi"}));

    let parsed = parse_line(
        r#"{"type":"control_request","request_id":"r2","request":{"subtype":"mcp_message"}}"#,
        &mut pending,
    );
    assert_eq!(parsed.events, [DriverEvent::Unknown]);
    let reply = parsed.reply.unwrap();
    assert_eq!(reply["type"], "control_response");
    assert_eq!(reply["response"]["subtype"], "error");
    assert_eq!(reply["response"]["request_id"], "r2");
}

#[test]
fn unknown_and_broken_lines_are_unknown_events_and_known_noise_is_skipped() {
    assert_eq!(parse("not json").0, [DriverEvent::Unknown]);
    assert_eq!(parse(r#"{"type":"brand_new"}"#).0, [DriverEvent::Unknown]);
    assert_eq!(parse(r#"{"no_type":1}"#).0, [DriverEvent::Unknown]);
    assert!(parse(r#"{"type":"rate_limit_event"}"#).0.is_empty());
    assert!(parse(r#"{"type":"user","message":{}}"#).0.is_empty());
}

#[test]
fn a_line_over_the_cap_is_skipped_and_the_next_one_is_read() {
    let data = format!("short\n{}\nnext\nlast", "x".repeat(50));
    let mut seen = Vec::new();
    for_each_line(Cursor::new(data), 10, |line| match line {
        Line::Text(text) => seen.push(text.to_string()),
        Line::TooLong => seen.push("<long>".to_string()),
    });
    assert_eq!(seen, ["short", "<long>", "next", "last"]);
}

#[test]
fn subagent_and_background_task_events_are_read_as_task_changes() {
    use super::claude_parse::TaskChange;
    let task = |line: &str| parse_line(line, &mut Pending::new()).task;
    assert_eq!(
        task(
            r#"{"type":"system","subtype":"task_started","task_id":"t1","description":"Review the diff","task_type":"local_agent"}"#
        ),
        Some(TaskChange::Started {
            id: "t1".into(),
            description: "Review the diff".into()
        })
    );
    assert_eq!(
        task(
            r#"{"type":"system","subtype":"task_notification","task_id":"t1","status":"completed","summary":"Done"}"#
        ),
        Some(TaskChange::Ended {
            id: "t1".into(),
            status: "completed".into(),
            description: "Done".into()
        })
    );
    // A progress update, or a patch that is not final, changes nothing.
    assert_eq!(
        task(
            r#"{"type":"system","subtype":"task_updated","task_id":"t1","patch":{"status":"running"}}"#
        ),
        None
    );
    assert_eq!(
        task(r#"{"type":"system","subtype":"task_progress","task_id":"t1"}"#),
        None
    );
    assert_eq!(
        task(
            r#"{"type":"system","subtype":"task_updated","task_id":"t1","patch":{"status":"killed"}}"#
        ),
        Some(TaskChange::Ended {
            id: "t1".into(),
            status: "killed".into(),
            description: String::new()
        })
    );
}
