//! `GET /api/projects/{id}/summaries` and `POST …/summaries/{id}/dismiss` over HTTP, against the files in the project's `notify/` folder, which people may also edit.

mod common;

use common::{Running, demo_project};
use serde_json::json;
use std::path::PathBuf;

fn line(id: &str, to: &str, title: &str) -> String {
    format!(
        r#"{{"id":"{id}","dismissed":false,"from":"2026-11-02T10:00:00Z","to":"{to}","results":[{{"taskId":1,"title":"{title}","at":"2026-11-02T10:30:00Z"}}]}}"#
    )
}

fn notify_dir(home: &std::path::Path, project: &str) -> PathBuf {
    home.join("shared")
        .join("projects")
        .join(project)
        .join("notify")
}

#[test]
fn summaries_are_listed_newest_first_and_dismissed_without_losing_the_line() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let projects = server.get("/api/projects").json();
    let project = projects["projects"][0]["id"].as_str().unwrap().to_string();
    let base = format!("/api/projects/{project}/summaries");

    let empty = server.get(&base);
    assert_eq!(empty.status, 200);
    assert_eq!(empty.json(), json!({"summaries": []}));

    let dir = notify_dir(home.path(), &project);
    std::fs::create_dir_all(&dir).unwrap();
    let a = line("s-20261102T110000Z", "2026-11-02T11:00:00Z", "First");
    let b = line("s-20261102T120000Z", "2026-11-02T12:00:00Z", "Second");
    std::fs::write(dir.join("2026-11-02.ldjson"), format!("{a}\n{b}\n")).unwrap();

    let listed = server.get(&base).json();
    let ids: Vec<_> = listed["summaries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].clone())
        .collect();
    assert_eq!(
        ids,
        [json!("s-20261102T120000Z"), json!("s-20261102T110000Z")]
    );
    assert_eq!(listed["summaries"][0]["results"][0]["title"], "Second");
    assert_eq!(listed["summaries"][0]["dismissed"], false);

    let dismissed = server.write("POST", &format!("{base}/s-20261102T110000Z/dismiss"), None);
    assert_eq!(dismissed.status, 200, "{}", dismissed.body);
    assert_eq!(dismissed.json()["summary"]["dismissed"], true);
    // The list leaves it out unless asked, and the file keeps the line.
    let visible = server.get(&base).json();
    assert_eq!(visible["summaries"].as_array().unwrap().len(), 1);
    assert_eq!(visible["summaries"][0]["id"], "s-20261102T120000Z");
    let all = server.get(&format!("{base}?dismissed=include")).json();
    assert_eq!(all["summaries"].as_array().unwrap().len(), 2);
    assert_eq!(all["summaries"][1]["dismissed"], true);
    let file = std::fs::read_to_string(dir.join("2026-11-02.ldjson")).unwrap();
    assert_eq!(file.lines().count(), 2);

    let again = server.write("POST", &format!("{base}/s-20261102T110000Z/dismiss"), None);
    assert_eq!(again.status, 200);
    let missing = server.write("POST", &format!("{base}/s-nope/dismiss"), None);
    assert_eq!(missing.status, 404);
    assert_eq!(missing.json()["error"]["code"], "message_not_found");

    // A hand edit of the file shows at once: the other line is dismissed by hand.
    let flagged = std::fs::read_to_string(dir.join("2026-11-02.ldjson"))
        .unwrap()
        .replace("\"dismissed\":false", "\"dismissed\":true");
    std::fs::write(dir.join("2026-11-02.ldjson"), flagged).unwrap();
    assert!(
        server.get(&base).json()["summaries"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    server.stop();
}

#[test]
fn a_change_to_the_folder_is_announced_as_a_change_of_the_messages() {
    use agent_board::file_store::watch::{Target, classify};
    let shared = std::path::Path::new("/data/shared");
    let id = "0123456789abcdef0123456789abcdef";
    let path = shared
        .join("projects")
        .join(id)
        .join("notify/2026-11-02.ldjson");
    assert!(matches!(classify(shared, &path), Some(Target::Notify(_))));
}
