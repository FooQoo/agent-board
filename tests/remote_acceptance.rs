//! A phone behind the ngrok entrance checks and unchecks an acceptance condition through the
//! board's own route, with the session and the checks every change there needs.

#[path = "support/mobile_monitor.rs"]
mod support;

use agent_board::domain::{Actor, Assignee, NewTask};
use agent_board::file_store::FileStore;
use support::{Running, home};

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
fn the_entrance_sets_a_condition_and_the_board_sees_it() {
    let home = fixture();
    let server = Running::start(home.path());
    let session = server.session();
    let base = server.base(home.path());
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
