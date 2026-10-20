mod common;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask, RunState};
use agent_board::file_store::{
    Answer, FileStore, history_language::HistoryLanguage, model::Choice,
};
use chrono::Utc;

fn new_task(body: &str) -> NewTask {
    NewTask {
        title: "Work".into(),
        description: body.into(),
        assignee: Assignee::Ai,
        actor: Actor::Ai,
        is_draft: false,
    }
}

#[test]
fn japanese_body_localizes_generated_operations_and_preserves_authored_reasons() {
    let root = tempfile::tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let project = store.create_project("Languages", Utc::now()).unwrap().id;
    let task = store
        .create_task(&project, new_task("作業の本文。"), Utc::now())
        .unwrap();
    assert!(task.history[0].reason.contains("作成しました"));
    let id = task.id;
    let ctx = || ChangeContext {
        actor: Actor::Ai,
        reason: "".into(),
    };
    let moved = store
        .move_work_task(&project, id, Column::Doing, ctx(), Utc::now())
        .unwrap()
        .value;
    assert!(
        moved
            .history
            .last()
            .unwrap()
            .reason
            .contains("移動しました")
    );
    let running = store
        .set_agent_status(&project, id, RunState::Running, ctx(), None, Utc::now())
        .unwrap()
        .value;
    assert!(
        running
            .history
            .last()
            .unwrap()
            .reason
            .contains("変更しました")
    );
    let note = store.add_history(&project, id, None, Utc::now()).unwrap();
    assert!(
        note.history
            .last()
            .unwrap()
            .reason
            .contains("進捗を記録しました")
    );
    let explicit = "Keep this exact wording.";
    let note = store
        .add_history(&project, id, Some(explicit), Utc::now())
        .unwrap();
    assert_eq!(note.history.last().unwrap().reason, explicit);
    let pending = store
        .request_decision(
            &project,
            id,
            Actor::Ai,
            "進めますか？",
            vec![
                Choice {
                    id: "yes".into(),
                    label: "進める".into(),
                },
                Choice {
                    id: "no".into(),
                    label: "止める".into(),
                },
            ],
            Utc::now(),
        )
        .unwrap()
        .value;
    assert!(
        pending
            .history
            .last()
            .unwrap()
            .reason
            .starts_with("判断を依頼しました")
    );
    let answered = store
        .answer_request(
            &project,
            id,
            pending.pending_request_id.as_deref().unwrap(),
            Answer {
                actor: Actor::Human,
                choice_id: Some("yes".into()),
                text: Some("お願いします".into()),
            },
            Utc::now(),
        )
        .unwrap();
    assert!(
        answered
            .history
            .last()
            .unwrap()
            .reason
            .starts_with("判断依頼に回答しました")
    );
    assert!(
        answered
            .history
            .last()
            .unwrap()
            .reason
            .contains("選択: 進める")
    );
    let draft = store
        .set_draft(&project, id, true, Utc::now())
        .unwrap()
        .value;
    assert_eq!(
        draft.history.last().unwrap().reason,
        "タスクを下書きにしました。"
    );
    let finalized = store
        .set_draft(&project, id, false, Utc::now())
        .unwrap()
        .value;
    assert_eq!(
        finalized.history.last().unwrap().reason,
        "下書きを確定しました。"
    );
    use agent_board::file_store::model::NewEpic;
    use agent_board::file_store::validate::EpicId;
    store
        .create_epic(
            &project,
            NewEpic {
                id: "LANG".into(),
                name: "Language".into(),
                color: None,
                is_draft: false,
                document: None,
            },
            Utc::now(),
        )
        .unwrap();
    let epic = store
        .set_task_epic(
            &project,
            id,
            Some(&EpicId::normalize("LANG").unwrap()),
            Actor::Ai,
            Utc::now(),
        )
        .unwrap()
        .value;
    assert_eq!(
        epic.history.last().unwrap().reason,
        "所属エピックをなしからLANGに変更しました。"
    );
    let archived = store.archive_task(&project, id, Utc::now()).unwrap().value;
    assert_eq!(
        archived.history.last().unwrap().reason,
        "ユーザーがアーカイブしました。"
    );
    let restored = store.restore_task(&project, id, Utc::now()).unwrap().value;
    assert_eq!(
        restored.history.last().unwrap().reason,
        "ユーザーが復元しました。"
    );
    store
        .move_work_task_for_user(
            &project,
            id,
            Column::Done,
            ChangeContext {
                actor: Actor::Human,
                reason: String::new(),
            },
            Utc::now(),
        )
        .unwrap();
    let bulk = store.archive_done(&project, &[id], Utc::now()).unwrap();
    assert_eq!(
        bulk.value.tasks[0].history.last().unwrap().reason,
        "ユーザーがアーカイブしました。"
    );
}

#[test]
fn request_language_is_explicit_and_does_not_leak_to_other_operations() {
    let root = tempfile::tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let project = store.create_project("Languages", Utc::now()).unwrap().id;
    let task = store
        .clone()
        .with_history_language(Some(HistoryLanguage::Japanese))
        .create_task(&project, new_task("English body."), Utc::now())
        .unwrap();
    assert!(task.history[0].reason.contains("作成しました"));
    let note = store
        .add_history(&project, task.id, None, Utc::now())
        .unwrap();
    assert!(
        note.history
            .last()
            .unwrap()
            .reason
            .starts_with("Progress note")
    );
    let jp = store
        .create_task(&project, new_task("日本語の本文。"), Utc::now())
        .unwrap();
    let note = store
        .with_history_language(Some(HistoryLanguage::English))
        .add_history(&project, jp.id, None, Utc::now())
        .unwrap();
    assert!(
        note.history
            .last()
            .unwrap()
            .reason
            .starts_with("Progress note")
    );
}

#[test]
fn browser_language_reaches_saved_history_and_invalid_headers_fall_back_to_body() {
    let root = tempfile::tempdir().unwrap();
    common::json_ok(root.path(), &["project", "create", "Demo", "--json"]);
    let running = common::Running::start(root.path());
    let project = running.get("/api/projects").json()["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let path = format!("/api/projects/{project}/tasks");
    for (setting, expected) in [
        ("ja", "タスクを"),
        ("en", "Created task"),
        ("unknown", "Created task"),
    ] {
        let mut headers = running.page_headers(&running.token());
        headers.push(("X-Agboard-Language".into(), setting.into()));
        let reply = running.request(
            "POST",
            &path,
            Some(r#"{"title":"Work","body":"English body.","assignee":"ai"}"#),
            &headers,
            Some("application/json"),
        );
        assert_eq!(reply.status, 201, "{}", reply.body);
        assert!(
            reply.json()["task"]["history"][0]["reason"]
                .as_str()
                .unwrap()
                .starts_with(expected)
        );
    }
}
