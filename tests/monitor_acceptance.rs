//! The mobile monitor checks and unchecks an acceptance condition through the
//! same session, Origin, and CSRF checks as an answer, and only with PUT.

#[path = "support/mobile_monitor.rs"]
mod support;

use agent_board::domain::{Actor, Assignee, NewTask};
use agent_board::file_store::FileStore;
use support::{ORIGIN, Running, home};

/// The monitor fixture plus task #2 with one condition.
fn fixture() -> tempfile::TempDir {
    let home = home();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.project_by_name("monitor").unwrap().id;
    store
        .create_task(
            &project,
            NewTask {
                title: "With a condition".into(),
                description: "---\nacceptance:\n- id: AC-1\n  text: Checked on the phone\n  done: false\n---\nBody.\n".into(),
                assignee: Assignee::Human,
                actor: Actor::Human,
                is_draft: false,
            },
            chrono::Utc::now(),
        )
        .unwrap();
    home
}

#[test]
fn the_monitor_sets_a_condition_and_the_board_sees_it() {
    let home = fixture();
    let server = Running::start(home.path());
    let session = server.session();
    let base = server.monitor_base(home.path());
    let path = format!("{base}/tasks/2/acceptance/AC-1");
    let reply = server.write(&session, "PUT", &path, r#"{"done":true}"#);
    assert_eq!(reply.status, 200, "{}", reply.body);
    let body: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
    assert_eq!(body["changed"], true);
    assert_eq!(body["task"]["acceptance"][0]["done"], true);
    let summary = server.get(&session, &format!("{base}/summary"));
    let summary: serde_json::Value = serde_json::from_str(&summary.body).unwrap();
    let task = summary["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["id"] == 2)
        .unwrap()
        .clone();
    assert_eq!(task["acceptance"]["done"], 1, "{task}");
}

#[test]
fn only_put_with_the_page_checks_can_set_a_condition() {
    let home = fixture();
    let server = Running::start(home.path());
    let session = server.session();
    let base = server.monitor_base(home.path());
    let path = format!("{base}/tasks/2/acceptance/AC-1");
    let body = r#"{"done":true}"#;
    let (cookie, csrf) = (session.cookie.as_str(), session.csrf.as_str());
    let full = [
        ("Cookie", cookie),
        ("Origin", ORIGIN),
        ("Sec-Fetch-Site", "same-origin"),
        ("X-Agboard-Csrf", csrf),
        ("Content-Type", "application/json"),
    ];
    for method in ["POST", "PATCH", "DELETE"] {
        let reply = server.request(method, &path, &full, body);
        assert_eq!(reply.status, 405, "{method}: {}", reply.body);
    }
    for (name, headers, status) in [
        (
            "no session",
            vec![("Content-Type", "application/json")],
            401,
        ),
        (
            "no csrf",
            vec![
                ("Cookie", cookie),
                ("Origin", ORIGIN),
                ("Sec-Fetch-Site", "same-origin"),
                ("Content-Type", "application/json"),
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
                ("Content-Type", "application/json"),
            ],
            403,
        ),
    ] {
        let reply = server.request("PUT", &path, &headers, body);
        assert_eq!(reply.status, status, "{name}: {}", reply.body);
    }
    // Nothing above changed the condition.
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.project_by_name("monitor").unwrap().id;
    let text = std::fs::read_to_string(
        home.path()
            .join(format!("shared/projects/{project}/tasks/2/TASK.md")),
    )
    .unwrap();
    assert!(text.contains("done: false"), "{text}");
}
