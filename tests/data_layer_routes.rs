//! The Summary and Detail routes of the data layer are registered on the PC server and on the
//! monitor, and answer `501 not_implemented` until their handlers are written. The existing
//! `/board` routes are untouched. Servers listen on port 0 in a temporary data directory.

mod common;
#[path = "support/mobile_monitor.rs"]
mod support;

use std::sync::Mutex;

use serde_json::Value;

/// The two harnesses guard the process environment with separate locks, so the tests of this
/// file run one at a time.
static SERIAL: Mutex<()> = Mutex::new(());

fn error_code(body: &str) -> String {
    let value: Value = serde_json::from_str(body).unwrap_or_else(|_| panic!("not JSON: {body}"));
    value["error"]["code"].as_str().unwrap().to_string()
}

fn project_id(home: &std::path::Path) -> String {
    agent_board::file_store::FileStore::open(&home.join("shared"))
        .project_by_name("monitor")
        .unwrap()
        .id
        .to_string()
}

#[test]
fn data_layer_routes_pc_answers_501_not_implemented() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    let server = common::Running::start(home.path());
    let base = format!("/api/projects/{id}");
    // The Summary has its handler (tests/summary_api.rs); the Detail routes still answer 501.
    for path in [
        format!("{base}/tasks/1/detail"),
        format!("{base}/epics/EPIC-1/detail"),
        format!("{base}/tasks/1/detail?sections=document"),
        format!("{base}/tasks/1/detail?sections=history"),
        format!("{base}/tasks/1/detail?sections=document,history"),
        format!("{base}/epics/EPIC-1/detail?sections=document"),
    ] {
        let reply = server.get(&path);
        assert_eq!(reply.status, 501, "{path}: {}", reply.body);
        assert_eq!(error_code(&reply.body), "not_implemented", "{path}");
        assert_eq!(reply.header("cache-control"), Some("no-store"), "{path}");
    }
    assert_eq!(server.get(&format!("{base}/board")).status, 200);
}

#[test]
fn data_layer_routes_pc_refuses_an_invalid_sections_query() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    let server = common::Running::start(home.path());
    for query in [
        "body",
        "",
        "history,document",
        "document,document",
        "Document",
    ] {
        for path in [
            format!("/api/projects/{id}/tasks/1/detail?sections={query}"),
            format!("/api/projects/{id}/epics/EPIC-1/detail?sections={query}"),
        ] {
            let reply = server.get(&path);
            assert_eq!(reply.status, 400, "{path}: {}", reply.body);
            assert_eq!(error_code(&reply.body), "invalid_sections", "{path}");
        }
    }
}

#[test]
fn data_layer_routes_monitor_answers_501_with_a_session_only() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    let server = support::Running::start(home.path());
    let session = server.session();
    let base = format!("/monitor/api/projects/{id}");
    let paths = [
        format!("{base}/summary"),
        format!("{base}/tasks/1/detail"),
        format!("{base}/epics/EPIC-1/detail"),
    ];
    // The Summary has its handler (tests/summary_api.rs); the Detail routes still answer 501.
    for path in &paths[1..] {
        let reply = server.get(&session, path);
        assert_eq!(reply.status, 501, "{path}: {}", reply.body);
        assert_eq!(error_code(&reply.body), "not_implemented", "{path}");
        assert_eq!(reply.header("cache-control"), Some("no-store"), "{path}");
    }
    let bad = server.get(&session, &format!("{base}/tasks/1/detail?sections=body"));
    assert_eq!(bad.status, 400, "{}", bad.body);
    assert_eq!(error_code(&bad.body), "invalid_sections");

    // Without a session the entrance answers as it does for the existing routes.
    let refused = server
        .request("GET", &format!("{base}/board"), &[], "")
        .status;
    assert_ne!(refused, 200);
    for path in &paths {
        let reply = server.request("GET", path, &[], "");
        assert_eq!(reply.status, refused, "{path}: {}", reply.body);
    }
    // The monitor stays read-only: a write to a new route is refused as before.
    let write = server.write(&session, "POST", &paths[0], "{}");
    assert_eq!(write.status, 405, "{}", write.body);
    assert_eq!(server.get(&session, &format!("{base}/board")).status, 200);
}
