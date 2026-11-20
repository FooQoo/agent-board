use super::rules::{ends_with_question, runs_agboard};
use super::*;
use crate::domain::{Actor, Assignee, Column, NewTask, RunState};
use crate::file_store::FileStore;
use crate::progress::FinalResultMissing;

fn call(command: &str) -> Call {
    Call {
        name: "Bash".into(),
        command: command.into(),
        path: String::new(),
    }
}

fn turn(calls: Vec<Call>) -> Option<Turn> {
    Some(Turn {
        last_text: None,
        calls,
    })
}

fn find(id: &str) -> &'static Rule {
    RULES.iter().find(|r| r.id == id).unwrap()
}

/// A progress table with one AI task, running in Doing when `running`, and
/// the given ids listed as missing a final result.
fn progress_with(running: bool, missing: &[i64]) -> Progress {
    let home = tempfile::tempdir().unwrap();
    let store = FileStore::open(&home.path().join("shared"));
    let now = chrono::Utc::now();
    let project = store.create_project("Demo", now).unwrap().id;
    store
        .create_task(
            &project,
            NewTask {
                title: "T".into(),
                description: "## 作業内容\n\nx\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n".into(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                draft: None,
            },
            now,
        )
        .unwrap();
    let snapshot = store.board(&project).unwrap();
    let mut table = progress::build_with(&snapshot, store.shared_dir(), now, Include::default());
    for task in table
        .epics
        .iter_mut()
        .flat_map(|e| e.tasks.iter_mut())
        .chain(table.unassigned.iter_mut())
    {
        task.draft = None;
        if running {
            task.task_status = Column::Doing;
            task.agent_status = RunState::Running;
        }
    }
    table.final_result_missing = missing
        .iter()
        .map(|id| FinalResultMissing {
            id: *id,
            title: "T".into(),
            task_path: "p".into(),
        })
        .collect();
    table
}

fn ctx(message: &str, calls: Vec<Call>, progress: Option<Progress>) -> Ctx<'static> {
    let c = Ctx::new(
        Some(Box::leak(message.to_string().into_boxed_str())),
        turn(calls),
        None,
    );
    c.progress.set(progress).unwrap();
    c
}

#[test]
fn detects_a_final_question() {
    assert!(ends_with_question("Done.\n\nShould I go ahead?"));
    assert!(ends_with_question("進めてよいですか？\n"));
    assert!(ends_with_question("Shall I continue? **\n\n"));
    assert!(ends_with_question("(Is that right?)"));
    assert!(!ends_with_question("Why? Because it is faster."));
    assert!(!ends_with_question("All done."));
    assert!(!ends_with_question("What next?\nDone."));
    assert!(!ends_with_question("```\nx?\n```"));
    assert!(!ends_with_question("  \n"));
}

#[test]
fn agboard_commands_are_recognized_by_tokens() {
    let ask: &[&[&str]] = &[&["message", "ask"], &["message", "answer"]];
    assert!(runs_agboard(
        "agboard --project \"x\" message ask --actor ai",
        ask
    ));
    assert!(runs_agboard("/usr/bin/agboard message answer Q-1", ask));
    assert!(runs_agboard(
        r#"tools.exec_command({cmd: "agboard message ask"})"#,
        ask
    ));
    assert!(!runs_agboard("agboard message show Q-1", ask));
    assert!(!runs_agboard("echo message ask", ask));
}

#[test]
fn question_rule() {
    let q = find("question").check;
    let ask = call("agboard message ask --actor ai --questions-json '{}'");
    assert!(q(&ctx("May I proceed?", vec![call("ls")], None)).is_some());
    assert!(q(&ctx("May I proceed?", vec![ask], None)).is_none());
    assert!(q(&ctx("All done.", vec![], None)).is_none());
    // No readable transcript: the turn cannot be checked.
    assert!(q(&Ctx::new(Some("May I proceed?"), None, None)).is_none());
}

#[test]
fn result_rule_for_viewable_output() {
    let r = find("result").check;
    let running = || Some(progress_with(true, &[]));
    let pr = call("gh pr create --title x --body y");
    let message = r(&ctx("Done.", vec![pr.clone()], running())).unwrap();
    assert!(message.contains("result add"));
    assert!(
        r(&ctx(
            "Done.",
            vec![call("git push -u origin feature/x")],
            running()
        ))
        .is_some()
    );
    assert!(
        r(&ctx(
            "Done.",
            vec![call("screencapture -x /tmp/shot.png")],
            running()
        ))
        .is_some()
    );
    let write = Call {
        name: "Write".into(),
        command: String::new(),
        path: "/tmp/mock.PNG".into(),
    };
    assert!(r(&ctx("Done.", vec![write], running())).is_some());
    // Reading an image, or a plain command, is not output.
    assert!(
        r(&ctx(
            "Done.",
            vec![call("ls /tmp/shot.png"), call("cargo test")],
            running()
        ))
        .is_none()
    );
    // A result in the turn, no running AI task, or no progress: nothing.
    let add = call("agboard result add 5 --summary s --file shot.png --actor ai");
    assert!(r(&ctx("Done.", vec![pr.clone(), add], running())).is_none());
    assert!(
        r(&ctx(
            "Done.",
            vec![pr.clone()],
            Some(progress_with(false, &[]))
        ))
        .is_none()
    );
    assert!(r(&ctx("Done.", vec![pr], None)).is_none());
}

#[test]
fn result_rule_for_a_missing_final_result() {
    let r = find("result").check;
    let message = r(&ctx("Done.", vec![], Some(progress_with(false, &[7, 9])))).unwrap();
    assert!(message.contains("#7, #9") && message.contains("--final"));
    assert!(r(&ctx("Done.", vec![], Some(progress_with(false, &[])))).is_none());
}

#[test]
fn matched_rules_block_once_with_one_reason() {
    let c = ctx(
        "Shall I merge?",
        vec![call("gh pr create --title x")],
        Some(progress_with(true, &[3])),
    );
    let out = decide(&c, RULES).unwrap();
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["decision"], "block");
    let reason = v["reason"].as_str().unwrap();
    assert!(reason.contains("[question]") && reason.contains("[result]"));
    assert!(reason.contains("#3") && reason.contains("pull request"));
    // No match, no block.
    assert!(
        decide(
            &ctx("All done.", vec![], Some(progress_with(true, &[]))),
            RULES
        )
        .is_none()
    );
}

#[test]
fn an_active_stop_hook_never_blocks() {
    let home = tempfile::tempdir().unwrap();
    let shared = home.path().join("shared");
    let project = FileStore::open(&shared)
        .create_project("Demo", chrono::Utc::now())
        .unwrap()
        .id;
    let input = |active| StopInput {
        stop_hook_active: active,
        last_assistant_message: Some("May I proceed?"),
        transcript_path: None,
        turn_id: None,
    };
    // Without a transcript the question rule cannot match, so use a file.
    let path = home.path().join("t.jsonl");
    std::fs::write(
        &path,
        r#"{"type":"user","message":{"role":"user","content":"hi"}}"#,
    )
    .unwrap();
    let with_file = |active| StopInput {
        transcript_path: path.to_str(),
        ..input(active)
    };
    assert!(run(&with_file(false), &shared, &project).is_some());
    assert!(run(&with_file(true), &shared, &project).is_none());
}

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
