//! `GET /api/projects/{id}/tasks/{task}/results`: the recorded results of a task.
//! The server listens on port 0.

mod common;

use common::{Running, demo_project, json_ok};
use serde_json::json;

#[test]
fn results_route_lists_what_the_cli_recorded() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = json_ok(home.path(), &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let server = Running::start(home.path());

    let empty = server.get(&format!("/api/projects/{pid}/tasks/1/results"));
    assert_eq!(empty.status, 200);
    assert_eq!(empty.json()["results"], json!([]));

    json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "result",
            "add",
            "1",
            "--summary",
            "Ready",
            "--link",
            "out/a.mp4",
            "--actor",
            "ai",
            "--json",
        ],
    );
    let listed = server
        .get(&format!("/api/projects/{pid}/tasks/1/results"))
        .json();
    assert_eq!(listed["taskId"], 1);
    assert_eq!(listed["results"][0]["version"], 1);
    assert_eq!(listed["results"][0]["summary"], "Ready");
    assert_eq!(listed["results"][0]["link"], "out/a.mp4");
    assert_eq!(listed["results"][0]["kind"], "progress");

    assert_eq!(
        server
            .get(&format!("/api/projects/{pid}/tasks/9/results"))
            .status,
        404
    );
    server.stop();
}
