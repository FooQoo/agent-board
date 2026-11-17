#[path = "support/qa.rs"]
mod qa;
#[path = "support/mobile_monitor.rs"]
mod support;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask};
use agent_board::file_store::FileStore;
use support::{Running, home};

fn pending_fixture() -> tempfile::TempDir {
    let home = home();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.project_by_name("monitor").unwrap().id;
    qa::ask(
        &store,
        &project,
        &[1],
        "Choose the first path",
        &[("keep", "Keep the current data"), ("reset", "Start over")],
    );
    let doing = store
        .create_task(
            &project,
            NewTask {
                title: "Doing question".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                draft: None,
            },
            chrono::Utc::now(),
        )
        .unwrap();
    store
        .move_work_task(
            &project,
            doing.id,
            Column::Doing,
            ChangeContext {
                actor: Actor::Ai,
                reason: "Start work".into(),
            },
            chrono::Utc::now(),
        )
        .unwrap();
    qa::ask(
        &store,
        &project,
        &[doing.id],
        "Add a note?",
        &[("yes", "Yes"), ("no", "No")],
    );
    home
}

#[test]
fn the_entrance_answers_questions_together_without_moving_the_tasks() {
    let home = pending_fixture();
    let server = Running::start(home.path());
    let session = server.session();
    let base = server.base(home.path());
    let board = server.get(&session, &format!("{base}/summary"));
    let board: serde_json::Value = serde_json::from_str(&board.body).unwrap();
    let questions = board["questions"].as_array().unwrap();
    assert_eq!(questions.len(), 2);
    assert_eq!(questions[0]["id"], "Q-1");
    assert_eq!(questions[0]["referencedBy"], serde_json::json!([1]));

    let question = server.get(&session, &format!("{base}/qa/Q-1"));
    assert_eq!(question.status, 200, "{}", question.body);
    let question: serde_json::Value = serde_json::from_str(&question.body).unwrap();
    assert_eq!(question["question"]["question"], "Choose the first path");

    let response = server.write(
        &session,
        "POST",
        &format!("{base}/qa/answers"),
        r#"{"answers":[{"questionId":"Q-1","choiceId":"keep","text":"Keep it"},{"questionId":"Q-2","text":"Continue"}]}"#,
    );
    assert_eq!(response.status, 200, "{}", response.body);
    let body: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(body["questions"][0]["answer"]["via"], "ui");
    assert_eq!(body["questions"][1]["answer"]["text"], "Continue");

    let board = server.get(&session, &format!("{base}/summary"));
    let board: serde_json::Value = serde_json::from_str(&board.body).unwrap();
    assert!(board["questions"].as_array().unwrap().is_empty());
    let tasks = board["tasks"].as_array().unwrap();
    let todo = tasks.iter().find(|task| task["id"] == 1).unwrap();
    assert_eq!(todo["taskStatus"], "todo");
    assert_eq!(todo["agentStatus"], "idle");
    let doing = tasks
        .iter()
        .find(|task| task["title"] == "Doing question")
        .unwrap();
    assert_eq!(doing["taskStatus"], "doing");
    assert_eq!(doing["agentStatus"], "idle");

    let again = server.write(
        &session,
        "POST",
        &format!("{base}/qa/answers"),
        r#"{"answers":[{"questionId":"Q-1","choiceId":"reset"}]}"#,
    );
    assert_eq!(again.status, 409, "{}", again.body);
    let again: serde_json::Value = serde_json::from_str(&again.body).unwrap();
    assert_eq!(again["questionAnswered"], serde_json::json!(["Q-1"]));
    assert_eq!(again["questions"][0]["answer"]["choiceId"], "keep");
}
