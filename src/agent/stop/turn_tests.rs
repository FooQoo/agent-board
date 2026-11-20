use super::*;

fn user(text: &str) -> String {
    serde_json::json!({"type":"user","message":{"role":"user","content":text}}).to_string()
}
fn assistant_text(text: &str) -> String {
    serde_json::json!({"type":"assistant","message":{"content":[{"type":"text","text":text}]}})
        .to_string()
}
fn bash(command: &str) -> String {
    serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":command}}]}}).to_string()
}
fn write_tool(path: &str) -> String {
    serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":path}}]}}).to_string()
}
fn tool_result(text: &str) -> String {
    serde_json::json!({"type":"user","message":{"content":[{"type":"tool_result","content":text}]}})
        .to_string()
}
fn codex_line(kind: &str, payload: serde_json::Value) -> String {
    let mut p = payload;
    p["type"] = kind.into();
    let outer = if kind.starts_with("task_") {
        "event_msg"
    } else {
        "response_item"
    };
    serde_json::json!({"timestamp":"t","ordinal":1,"type":outer,"payload":p}).to_string()
}

fn read(lines: &[String], turn_id: Option<&str>) -> Turn {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.jsonl");
    std::fs::write(&path, lines.join("\n")).unwrap();
    turn::read_turn(path.to_str().unwrap(), turn_id).unwrap()
}

#[test]
fn a_claude_turn_starts_at_the_last_real_user_message() {
    let t = read(
        &[
            user("hi"),
            bash("gh pr create"),
            user("next"),
            bash("ls"),
            tool_result("agboard message ask in a result"),
            write_tool("/tmp/a.png"),
            assistant_text("Q?"),
        ],
        None,
    );
    assert_eq!(t.calls.len(), 2);
    assert_eq!(t.calls[0].command, "ls");
    assert_eq!(t.calls[1].path, "/tmp/a.png");
    assert_eq!(t.last_text.as_deref(), Some("Q?"));
}

#[test]
fn codex_rollouts_are_scanned_by_turn_id() {
    let ask_js = r#"const r = await tools.exec_command({cmd: "agboard --project demo message ask --actor ai --json"}); text(r);"#;
    let lines = [
        codex_line("task_started", serde_json::json!({"turn_id":"turn-1"})),
        codex_line(
            "custom_tool_call",
            serde_json::json!({"name":"exec","input":ask_js}),
        ),
        codex_line("task_started", serde_json::json!({"turn_id":"turn-2"})),
        // Injected context is a user message but starts no turn.
        codex_line(
            "message",
            serde_json::json!({"role":"user","content":[{"type":"input_text","text":"context"}]}),
        ),
        codex_line(
            "function_call",
            serde_json::json!({"name":"shell","arguments":"{\"command\":[\"ls\"]}"}),
        ),
        codex_line(
            "message",
            serde_json::json!({"role":"assistant","content":[{"type":"output_text","text":"Which one?"}]}),
        ),
    ];
    assert_eq!(read(&lines, Some("turn-2")).calls.len(), 1);
    assert_eq!(read(&lines, None).calls.len(), 1);
    let first = read(&lines, Some("turn-1"));
    assert_eq!(first.calls.len(), 2);
    assert!(first.calls[0].command.contains("message ask"));
    assert_eq!(first.last_text.as_deref(), Some("Which one?"));
}
