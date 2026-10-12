#[path = "support/mobile_monitor.rs"]
mod support;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewCard};
use agent_board::file_store::FileStore;
use agent_board::file_store::model::Choice;
use support::{ORIGIN, Running, home, monitor_token, token};

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
        .create_card(
            &project,
            NewCard {
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
        .move_work_card(
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

fn answer_headers(token: &str) -> [(&'static str, &str); 4] {
    [
        ("Host", "monitor.example"),
        ("Origin", ORIGIN),
        ("Sec-Fetch-Site", "same-origin"),
        ("X-Agboard-Token", token),
    ]
}

#[test]
fn monitor_answers_todo_and_doing_pending_without_moving_the_cards() {
    let home = pending_fixture();
    let server = Running::start(home.path());
    let page = server.request("GET", "/monitor/", &[("Host", "monitor.example")], "");
    let token = monitor_token(&page.body);
    let base = server.monitor_base(home.path());
    let board = server.request(
        "GET",
        &format!("{base}/board"),
        &[("Host", "monitor.example")],
        "",
    );
    let board: serde_json::Value = serde_json::from_str(&board.body).unwrap();
    let todo_request = board["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|card| card["id"] == 1)
        .unwrap()["pendingRequestId"]
        .as_str()
        .unwrap();

    let todo = server.request(
        "POST",
        &format!("{base}/cards/1/answer"),
        &[
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &token),
            ("Content-Type", "application/json"),
        ],
        &format!(r#"{{"requestId":"{todo_request}","choiceId":"keep","text":"Keep it"}}"#),
    );
    assert_eq!(todo.status, 200, "{}", todo.body);
    let todo_body: serde_json::Value = serde_json::from_str(&todo.body).unwrap();
    assert_eq!(todo_body["card"]["cardStatus"], "todo");
    assert_eq!(todo_body["card"]["agentStatus"], "idle");
    let todo_answer = todo_body["card"]["history"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| event["kind"] == "answer")
        .unwrap();
    assert_eq!(todo_answer["actor"], "human");
    assert_eq!(todo_answer["choiceId"], "keep");
    assert_eq!(todo_answer["reason"], "Keep it");

    let board = server.request(
        "GET",
        &format!("{base}/board"),
        &[("Host", "monitor.example")],
        "",
    );
    let board: serde_json::Value = serde_json::from_str(&board.body).unwrap();
    let doing = board["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|card| card["title"] == "Doing question")
        .unwrap();
    let doing_id = doing["id"].as_i64().unwrap();
    let request_id = doing["pendingRequestId"].as_str().unwrap();
    let response = server.request(
        "POST",
        &format!("{base}/cards/{doing_id}/answer"),
        &[
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &token),
            ("Content-Type", "application/json"),
        ],
        &format!(r#"{{"requestId":"{request_id}","text":"Continue"}}"#),
    );
    assert_eq!(response.status, 200, "{}", response.body);
    let response: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(response["card"]["cardStatus"], "doing");
    assert_eq!(response["card"]["agentStatus"], "idle");
    assert!(
        response["card"]["history"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["kind"] == "answer" && event["actor"] == "human")
    );
}

#[test]
fn monitor_answer_requires_its_page_origin_host_and_token_and_only_allows_post() {
    let home = pending_fixture();
    let server = Running::start(home.path());
    let page = server.request("GET", "/monitor/", &[("Host", "monitor.example")], "");
    let monitor_token = monitor_token(&page.body);
    let pc_page = server.request("GET", "/board/", &[("Host", "monitor.example")], "");
    let pc_token = token(&pc_page.body);
    let path = format!("{}/cards/1/answer", server.monitor_base(home.path()));
    let body = r#"{"requestId":"stale","text":"answer"}"#;

    for headers in [
        vec![],
        vec![
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
        ],
        vec![
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", "wrong"),
        ],
        vec![
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &pc_token),
        ],
        vec![
            ("Host", "monitor.example"),
            ("Origin", "https://evil.example"),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &monitor_token),
        ],
        vec![
            ("Host", "other.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &monitor_token),
        ],
        vec![
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-site"),
            ("X-Agboard-Token", &monitor_token),
        ],
        vec![
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &monitor_token),
            ("X-HTTP-Method-Override", "DELETE"),
        ],
    ] {
        let result = server.request("POST", &path, &headers, body);
        assert_eq!(result.status, 403, "headers={headers:?}; {}", result.body);
    }

    let stale = server.request(
        "POST",
        &path,
        &[
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", "old-monitor-token"),
        ],
        body,
    );
    assert_eq!(stale.status, 403);
    assert!(stale.body.contains("page_out_of_date"));

    let method = server.request("GET", &path, &answer_headers(&monitor_token), "");
    assert_eq!(method.status, 405);
    let generic_write = server.request(
        "POST",
        &format!("{}/cards/1/move", server.monitor_base(home.path())),
        &answer_headers(&monitor_token),
        "{}",
    );
    assert_eq!(generic_write.status, 405);

    let board = server.request(
        "GET",
        &format!("{}/board", server.monitor_base(home.path())),
        &[("Host", "monitor.example")],
        "",
    );
    let board: serde_json::Value = serde_json::from_str(&board.body).unwrap();
    let todo = board["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|card| card["id"] == 1)
        .unwrap();
    assert_eq!(todo["agentStatus"], "pending");
    assert_eq!(todo["cardStatus"], "todo");
}
