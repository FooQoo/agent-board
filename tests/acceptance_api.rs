//! The acceptance conditions over HTTP: task conditions are saved as a body
//! and a list of conditions, the frontmatter is written by the server, and
//! other frontmatter keys are kept.

mod common;

use std::path::Path;

use common::{Running, demo_project, json_ok};
use serde_json::json;

fn project_id(home: &Path) -> String {
    json_ok(home, &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn a_task_is_created_from_a_body_and_its_conditions() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let tasks = format!("/api/projects/{pid}/tasks");
    let payload = json!({
        "title": "Listed",
        "assignee": "ai",
        "body": "Free body.\n",
        "acceptance": [{"id": "AC-1", "text": "Returns JSON", "done": false}],
    });
    let created = server.write("POST", &tasks, Some(&payload.to_string()));
    assert_eq!(created.status, 201, "{}", created.body);
    let task = &created.json()["task"];
    assert_eq!(task["body"], "Free body.\n");
    assert_eq!(
        task["acceptance"],
        json!([{"id": "AC-1", "text": "Returns JSON", "done": false}])
    );
    assert_eq!(task["acceptanceError"], false);
    assert!(
        task["description"]
            .as_str()
            .unwrap()
            .starts_with("---\nacceptance:\n")
    );
    server.stop();
}

#[test]
fn a_task_takes_either_a_description_or_a_body_not_both() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let payload = json!({
        "title": "Both",
        "assignee": "ai",
        "description": "---\nacceptance: []\n---\n",
        "body": "x",
    });
    let reply = server.write(
        "POST",
        &format!("/api/projects/{pid}/tasks"),
        Some(&payload.to_string()),
    );
    assert_eq!(reply.status, 422, "{}", reply.body);
    assert_eq!(reply.code(), "invalid_value");
    server.stop();
}

#[test]
fn saving_a_body_keeps_the_conditions_and_other_frontmatter_keys() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let tasks = format!("/api/projects/{pid}/tasks");
    let description = "---\ntags:\n  - plan\nacceptance:\n  - id: AC-1\n    text: Works\n    done: false\n---\n\nold\n";
    let created = server.write(
        "POST",
        &tasks,
        Some(&json!({"title": "Keep", "assignee": "ai", "description": description}).to_string()),
    );
    assert_eq!(created.status, 201, "{}", created.body);
    let id = created.json()["task"]["id"].as_i64().unwrap();
    let task_path = format!("{tasks}/{id}");
    assert_eq!(
        server
            .write(
                "PUT",
                &format!("{task_path}/draft"),
                Some(r#"{"isDraft":true}"#)
            )
            .status,
        200
    );

    let saved = server.write(
        "PATCH",
        &task_path,
        Some(&json!({"body": "new body\n"}).to_string()),
    );
    assert_eq!(saved.status, 200, "{}", saved.body);
    let task = &saved.json()["task"];
    assert_eq!(task["body"], "new body\n");
    assert_eq!(task["acceptance"][0]["id"], "AC-1");
    let text = task["description"].as_str().unwrap();
    assert!(text.contains("tags:"), "{text}");

    let conditions = server.write(
        "PATCH",
        &task_path,
        Some(&json!({"acceptance": []}).to_string()),
    );
    assert_eq!(conditions.status, 200, "{}", conditions.body);
    let task = &conditions.json()["task"];
    assert_eq!(task["acceptance"], json!([]));
    assert_eq!(task["body"], "new body\n", "the body is kept");
    assert!(task["description"].as_str().unwrap().contains("tags:"));
    server.stop();
}

#[test]
fn a_refused_conditions_list_saves_nothing() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let task_path = format!("/api/projects/{pid}/tasks/1");
    assert_eq!(
        server
            .write(
                "PUT",
                &format!("{task_path}/draft"),
                Some(r#"{"isDraft":true}"#)
            )
            .status,
        200
    );
    let description_of_task_one = |server: &Running| {
        server.get(&format!("/api/projects/{pid}/board")).json()["tasks"][0]["description"].clone()
    };
    let before = description_of_task_one(&server);
    let duplicate = json!({
        "acceptance": [
            {"id": "AC-1", "text": "one", "done": false},
            {"id": "AC-1", "text": "two", "done": false},
        ],
    });
    let reply = server.write("PATCH", &task_path, Some(&duplicate.to_string()));
    assert_eq!(reply.status, 422, "{}", reply.body);
    assert_eq!(description_of_task_one(&server), before);
    server.stop();
}

#[test]
fn editing_a_draft_body_keeps_the_current_markdown_history() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let created = server.write(
        "POST",
        &format!("/api/projects/{pid}/tasks"),
        Some(
            &json!({
                "title": "Draft body edit",
                "assignee": "ai",
                "body": "Before edit.\n",
                "acceptance": [{"id": "AC-1", "text": "Keep this condition", "done": false}],
                "isDraft": true,
            })
            .to_string(),
        ),
    );
    assert_eq!(created.status, 201, "{}", created.body);
    let id = created.json()["task"]["id"].as_i64().unwrap();
    let moved = server.write(
        "POST",
        &format!("/api/projects/{pid}/tasks/{id}/move"),
        Some(r#"{"taskStatus":"doing","reason":"Reprioritized"}"#),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    let latest_history = moved.json()["task"]["history"].clone();

    let edited = server.write(
        "PATCH",
        &format!("/api/projects/{pid}/tasks/{id}"),
        Some(r#"{"body":"After edit.\n"}"#),
    );
    assert_eq!(edited.status, 200, "{}", edited.body);
    let task = &edited.json()["task"];
    assert_eq!(task["body"], "After edit.\n");
    assert_eq!(task["acceptance"][0]["text"], "Keep this condition");
    assert_eq!(task["history"], latest_history);
    assert!(task["description"].as_str().unwrap().contains("history:"));
    server.stop();
}

#[test]
fn an_epic_is_saved_as_plain_markdown_without_condition_input() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let epics = format!("/api/projects/{pid}/epics");
    let body = "## Goal\n\nGoal.\n\n## Reference conditions\n\n- [x] Planned\n";
    let created = server.write(
        "POST",
        &epics,
        Some(
            &json!({
                "id": "plan-1", "name": "Plan", "body": body,
            })
            .to_string(),
        ),
    );
    assert_eq!(created.status, 201, "{}", created.body);
    let epic = &created.json()["epic"];
    assert_eq!(epic["body"], body);
    assert!(epic.get("acceptance").is_none());
    assert!(!epic["plan"].as_str().unwrap().contains("acceptance:"));
    let patched = server.write(
        "PATCH",
        &format!("{epics}/PLAN-1"),
        Some(&json!({"acceptance": []}).to_string()),
    );
    assert_eq!(patched.status, 400, "{}", patched.body);
    assert_eq!(
        server.get(&format!("{epics}/PLAN-1")).json()["epic"]["body"],
        body
    );
    server.stop();
}

#[test]
fn the_board_move_to_done_is_not_blocked_by_unmet_conditions() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let tasks = format!("/api/projects/{pid}/tasks");
    let created = server.write(
        "POST",
        &tasks,
        Some(
            &json!({
                "title": "Unmet",
                "assignee": "ai",
                "body": "b\n",
                "acceptance": [{"id": "AC-1", "text": "Open", "done": false}],
            })
            .to_string(),
        ),
    );
    assert_eq!(created.status, 201, "{}", created.body);
    let id = created.json()["task"]["id"].as_i64().unwrap();
    let moved = server.write(
        "POST",
        &format!("{tasks}/{id}/move"),
        Some(r#"{"taskStatus":"done","reason":"Dropped by the person."}"#),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    assert_eq!(moved.json()["task"]["taskStatus"], "done");
    server.stop();
}
