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

fn kinds(items: &[Item]) -> Vec<Kind> {
    items.iter().map(|i| i.kind).collect()
}

#[test]
fn question_rule_gives_check_items() {
    let q = find("question").check;
    let ask = call("agboard message ask --actor ai --questions-json '{}'");
    let items = q(&ctx("May I proceed?", vec![call("ls")], None));
    assert_eq!(kinds(&items), [Kind::Check, Kind::Check]);
    assert!(items[0].text.contains("message ask"));
    assert!(items[1].text.contains("images"));
    assert!(q(&ctx("May I proceed?", vec![ask], None)).is_empty());
    assert!(q(&ctx("All done.", vec![], None)).is_empty());
    // No readable transcript: the turn cannot be checked.
    assert!(q(&Ctx::new(Some("May I proceed?"), None, None)).is_empty());
}

#[test]
fn result_rule_for_a_pull_request_is_definite() {
    let r = find("result").check;
    let running = || Some(progress_with(true, &[]));
    let pr = call("gh pr create --title x --body y");
    let items = r(&ctx("Done.", vec![pr.clone()], running()));
    assert_eq!(kinds(&items), [Kind::Definite, Kind::Check]);
    assert!(items[0].text.contains("pull request"));
    assert!(items[1].text.contains("history add"));
    // A push next to the pull request is covered by the definite item.
    let both = r(&ctx(
        "Done.",
        vec![pr.clone(), call("git push -u origin feature/x")],
        running(),
    ));
    assert_eq!(kinds(&both), [Kind::Definite, Kind::Check]);
    // A recorded result, no running AI task, or no progress: nothing.
    let add = call("agboard result add 5 --summary s --file shot.png --actor ai");
    assert!(r(&ctx("Done.", vec![pr.clone(), add], running())).is_empty());
    assert!(
        r(&ctx(
            "Done.",
            vec![pr.clone()],
            Some(progress_with(false, &[]))
        ))
        .is_empty()
    );
    assert!(r(&ctx("Done.", vec![pr], None)).is_empty());
}

#[test]
fn result_rule_for_a_push_or_an_image_is_a_check() {
    let r = find("result").check;
    let running = || Some(progress_with(true, &[]));
    let write = Call {
        name: "Write".into(),
        command: String::new(),
        path: "/tmp/mock.PNG".into(),
    };
    for calls in [
        vec![call("git push -u origin feature/x")],
        vec![call("screencapture -x /tmp/shot.png")],
        vec![write],
    ] {
        let items = r(&ctx("Done.", calls, running()));
        assert_eq!(kinds(&items), [Kind::Check, Kind::Check]);
        assert!(items[0].text.contains("pushed or produced an image"));
        assert!(items[1].text.contains("history add"));
    }
    // Reading an image, or a plain command, triggers nothing.
    let none = r(&ctx(
        "Done.",
        vec![call("ls /tmp/shot.png"), call("cargo test")],
        running(),
    ));
    assert!(none.is_empty());
}

#[test]
fn result_rule_for_a_missing_final_result_is_definite() {
    let r = find("result").check;
    let items = r(&ctx("Done.", vec![], Some(progress_with(false, &[7, 9]))));
    assert_eq!(kinds(&items), [Kind::Definite, Kind::Definite]);
    assert!(items[0].text.contains("Task #7") && items[0].text.contains("result add 7 --final"));
    assert!(items[1].text.contains("Task #9"));
    assert!(r(&ctx("Done.", vec![], Some(progress_with(false, &[])))).is_empty());
}

#[test]
fn the_checklist_separates_found_items_from_checks() {
    let c = ctx(
        "Shall I merge?",
        vec![call("gh pr create --title x")],
        Some(progress_with(true, &[3])),
    );
    let out = decide(&c, RULES).unwrap();
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["decision"], "block");
    let reason = v["reason"].as_str().unwrap();
    assert!(reason.starts_with("Agent Board turn-end checklist."));
    let found = reason.find("\nFound:\n").unwrap();
    let check = reason.find("\nCheck:\n").unwrap();
    assert!(found < check);
    let (found_part, check_part) = (&reason[found..check], &reason[check..]);
    assert!(found_part.contains("- NG: Task #3 has all conditions met"));
    assert!(found_part.contains("- NG: You opened a pull request"));
    assert!(!found_part.contains("[ ]"));
    assert!(check_part.contains("- [ ] Does your question wait"));
    assert!(check_part.contains("- [ ] Record meaningful progress"));
    assert!(!check_part.contains("NG:"));
}

#[test]
fn an_empty_section_is_left_out_and_no_item_means_no_block() {
    // Only checks: no Found section.
    let q = decide(&ctx("Shall I?", vec![call("ls")], None), RULES).unwrap();
    let reason = serde_json::from_str::<serde_json::Value>(&q).unwrap()["reason"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(reason.contains("Check:") && !reason.contains("Found:"));
    // Only a definite item: no Check section.
    let d = decide(
        &ctx("Done.", vec![], Some(progress_with(false, &[4]))),
        RULES,
    )
    .unwrap();
    let reason = serde_json::from_str::<serde_json::Value>(&d).unwrap()["reason"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(reason.contains("Found:") && !reason.contains("Check:"));
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
    let input = |active| StopFields {
        stop_hook_active: Some(active),
        last_assistant_message: Some("May I proceed?".into()),
        ..Default::default()
    };
    // Without a transcript the question rule cannot match, so use a file.
    let path = home.path().join("t.jsonl");
    std::fs::write(
        &path,
        r#"{"type":"user","message":{"role":"user","content":"hi"}}"#,
    )
    .unwrap();
    let with_file = |active| StopFields {
        transcript_path: path.to_str().map(String::from),
        ..input(active)
    };
    assert!(run(&with_file(false), &shared, &project).is_some());
    assert!(run(&with_file(true), &shared, &project).is_none());
}
