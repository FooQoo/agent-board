#[path = "support/mobile_monitor.rs"]
mod support;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask};
use agent_board::file_store::FileStore;
use agent_board::file_store::model::Choice;
use support::{ORIGIN, Running, Session, home};

fn pending_fixture() -> tempfile::TempDir {
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
                    label: "Keep the current data".into(),
                },
                Choice {
                    id: "reset".into(),
                    label: "Start over".into(),
                },
            ],
            chrono::Utc::now(),
        )
        .unwrap();
    let doing = store
        .create_task(
            &project,
            NewTask {
                title: "Doing question".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
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
    store
        .request_decision(
            &project,
            doing.id,
            Actor::Ai,
            "Add a note?",
            vec![
                Choice {
                    id: "yes".into(),
                    label: "Yes".into(),
                },
                Choice {
                    id: "no".into(),
                    label: "No".into(),
                },
            ],
            chrono::Utc::now(),
        )
        .unwrap();
    home
}

fn answer_headers(session: &Session) -> [(&'static str, &str); 5] {
    [
        ("Cookie", &session.cookie),
        ("Origin", ORIGIN),
        ("Sec-Fetch-Site", "same-origin"),
        ("X-Agboard-Csrf", &session.csrf),
        ("Content-Type", "application/json"),
    ]
}

#[test]
fn monitor_answers_todo_and_doing_pending_without_moving_the_tasks() {
    let home = pending_fixture();
    let server = Running::start(home.path());
    let session = server.session();
    let base = server.monitor_base(home.path());
    let board = server.get(&session, &format!("{base}/board"));
    let board: serde_json::Value = serde_json::from_str(&board.body).unwrap();
    let todo_request = board["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["id"] == 1)
        .unwrap()["pendingRequestId"]
        .as_str()
        .unwrap();

    let todo = server.write(
        &session,
        "POST",
        &format!("{base}/tasks/1/answer"),
        &format!(r#"{{"requestId":"{todo_request}","choiceId":"keep","text":"Keep it"}}"#),
    );
    assert_eq!(todo.status, 200, "{}", todo.body);
    let todo_body: serde_json::Value = serde_json::from_str(&todo.body).unwrap();
    assert_eq!(todo_body["task"]["taskStatus"], "todo");
    assert_eq!(todo_body["task"]["agentStatus"], "idle");
    let todo_answer = todo_body["task"]["history"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| {
            event["reason"]
                .as_str()
                .is_some_and(|reason| reason.contains("Keep it"))
        })
        .unwrap();
    assert_eq!(todo_answer.as_object().unwrap().len(), 2);
    assert!(todo_answer["reason"].as_str().unwrap().contains("Keep it"));

    let board = server.get(&session, &format!("{base}/board"));
    let board: serde_json::Value = serde_json::from_str(&board.body).unwrap();
    let doing = board["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["title"] == "Doing question")
        .unwrap();
    let doing_id = doing["id"].as_i64().unwrap();
    let request_id = doing["pendingRequestId"].as_str().unwrap();
    let response = server.write(
        &session,
        "POST",
        &format!("{base}/tasks/{doing_id}/answer"),
        &format!(r#"{{"requestId":"{request_id}","text":"Continue"}}"#),
    );
    assert_eq!(response.status, 200, "{}", response.body);
    let response: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(response["task"]["taskStatus"], "doing");
    assert_eq!(response["task"]["agentStatus"], "idle");
    assert!(
        response["task"]["history"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["reason"]
                .as_str()
                .is_some_and(|reason| reason.contains("Continue")))
    );
}

#[test]
fn monitor_answer_requires_its_session_origin_host_and_csrf_and_only_allows_post() {
    let home = pending_fixture();
    let server = Running::start(home.path());
    let session = server.session();
    let path = format!("{}/tasks/1/answer", server.monitor_base(home.path()));
    let body = r#"{"requestId":"stale","text":"answer"}"#;
    let cookie = session.cookie.as_str();
    let csrf = session.csrf.as_str();

    for (name, headers, status) in [
        ("no session", vec![], 401),
        (
            "no origin",
            vec![
                ("Cookie", cookie),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Csrf", csrf),
            ],
            403,
        ),
        (
            "no csrf",
            vec![
                ("Cookie", cookie),
                ("Origin", ORIGIN),
                ("Sec-Fetch-Site", "same-origin"),
            ],
            403,
        ),
        (
            "wrong csrf",
            vec![
                ("Cookie", cookie),
                ("Origin", ORIGIN),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Csrf", "wrong"),
            ],
            403,
        ),
        (
            "other origin",
            vec![
                ("Cookie", cookie),
                ("Origin", "https://evil.example"),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Csrf", csrf),
            ],
            403,
        ),
        (
            "other host",
            vec![
                ("Host", "other.example"),
                ("Cookie", cookie),
                ("Origin", ORIGIN),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Csrf", csrf),
            ],
            403,
        ),
        (
            "same-site fetch",
            vec![
                ("Cookie", cookie),
                ("Origin", ORIGIN),
                ("Sec-Fetch-Site", "same-site"),
                ("X-Agboard-Csrf", csrf),
            ],
            403,
        ),
        (
            "method override",
            vec![
                ("Cookie", cookie),
                ("Origin", ORIGIN),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Csrf", csrf),
                ("X-HTTP-Method-Override", "DELETE"),
            ],
            403,
        ),
    ] {
        let result = server.request("POST", &path, &headers, body);
        assert_eq!(
            result.status, status,
            "{name}: headers={headers:?}; {}",
            result.body
        );
    }

    let method = server.request("GET", &path, &answer_headers(&session), "");
    assert_eq!(method.status, 405);
    let generic_write = server.request(
        "POST",
        &format!("{}/tasks/1/move", server.monitor_base(home.path())),
        &answer_headers(&session),
        "{}",
    );
    assert_eq!(generic_write.status, 405);

    let board = server.get(
        &session,
        &format!("{}/board", server.monitor_base(home.path())),
    );
    let board: serde_json::Value = serde_json::from_str(&board.body).unwrap();
    let todo = board["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["id"] == 1)
        .unwrap();
    assert_eq!(todo["agentStatus"], "pending");
    assert_eq!(todo["taskStatus"], "todo");
}
