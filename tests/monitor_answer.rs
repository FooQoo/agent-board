#[path = "support/qa.rs"]
mod qa;
#[path = "support/mobile_monitor.rs"]
mod support;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask};
use agent_board::file_store::FileStore;
use support::{ORIGIN, Running, Session, home};

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
    qa::ask(
        &store,
        &project,
        &[doing.id],
        "Add a note?",
        &[("yes", "Yes"), ("no", "No")],
    );
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
fn monitor_answers_questions_together_without_moving_the_tasks() {
    let home = pending_fixture();
    let server = Running::start(home.path());
    let session = server.session();
    let base = server.monitor_base(home.path());
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

#[test]
fn monitor_answer_requires_its_session_origin_host_and_csrf_and_only_allows_post() {
    let home = pending_fixture();
    let server = Running::start(home.path());
    let session = server.session();
    let path = format!("{}/qa/answers", server.monitor_base(home.path()));
    let body = r#"{"answers":[{"questionId":"Q-1","text":"answer"}]}"#;
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
    assert_ne!(method.status, 200);
    let withdraw = server.request(
        "POST",
        &format!(
            "{}/qa/requests/0123/withdraw",
            server.monitor_base(home.path())
        ),
        &answer_headers(&session),
        "{}",
    );
    assert_eq!(withdraw.status, 405);
    let generic_write = server.request(
        "POST",
        &format!("{}/tasks/1/move", server.monitor_base(home.path())),
        &answer_headers(&session),
        "{}",
    );
    assert_eq!(generic_write.status, 405);

    let board = server.get(
        &session,
        &format!("{}/summary", server.monitor_base(home.path())),
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
