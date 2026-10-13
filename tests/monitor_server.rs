#[path = "support/mobile_monitor.rs"]
mod support;

use support::{Running, home};

#[test]
fn monitor_api_is_read_only_allowlisted_and_uses_the_shared_snapshot() {
    let home = home();
    let server = Running::start(home.path());
    let host = server.monitor_headers();
    let projects = server.request("GET", "/monitor/api/projects", &host, "");
    assert_eq!(projects.status, 200, "{}", projects.body);
    assert_eq!(projects.header("cache-control"), Some("no-store"));
    assert_eq!(projects.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(projects.header("referrer-policy"), Some("no-referrer"));
    let base = server.monitor_base(home.path());
    let board = server.request("GET", &format!("{base}/board"), &host, "");
    assert_eq!(board.status, 200, "{}", board.body);
    assert!(board.body.contains("Sample"));
    let epics = server.request("GET", &format!("{base}/epics"), &host, "");
    assert_eq!(epics.status, 200, "{}", epics.body);
    assert_eq!(epics.header("cache-control"), Some("no-store"));
    let board_json: serde_json::Value = serde_json::from_str(&board.body).unwrap();
    let epics_json: serde_json::Value = serde_json::from_str(&epics.body).unwrap();
    assert_eq!(epics_json["epics"], board_json["epics"]);

    for method in ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] {
        let result = server.request(method, &format!("{base}/board"), &host, "{}");
        assert_eq!(result.status, 405, "{method}: {}", result.body);
        assert_eq!(
            server
                .request(method, &format!("{base}/epics"), &host, "{}")
                .status,
            405
        );
        let unknown = server.request(method, "/monitor/api/unknown", &host, "");
        assert_eq!(unknown.status, 405, "{method}: {}", unknown.body);
    }
    for path in [
        "/monitor/api/health",
        "/monitor/api/notify",
        "/monitor/api/archive",
        "/monitor/api/projects/not-a-project/archive",
        "/monitor/assets/app.js",
    ] {
        assert_eq!(server.request("GET", path, &host, "").status, 404, "{path}");
    }
    assert_eq!(server.request("GET", "/monitor", &host, "").status, 200);
    let html = server.request("GET", "/monitor/", &host, "");
    assert_eq!(html.status, 200);
    assert!(!html.body.contains("agboard-token"));
    assert_eq!(html.header("cache-control"), Some("no-store"));
}

#[test]
fn monitor_assets_are_not_cached_including_viewer_chunks_and_missing_files() {
    let home = home();
    let server = Running::start(home.path());
    let host = server.monitor_headers();
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("../web/dist/monitor/manifest.json")).unwrap();
    for asset in manifest["assets"].as_array().unwrap() {
        let name = asset["name"].as_str().unwrap();
        let path = format!("/assets/monitor/{name}?v=test");
        for method in ["GET", "HEAD"] {
            let response = server.request(method, &path, &host, "");
            assert_eq!(response.status, 200, "{method} {path}");
            assert_eq!(response.header("cache-control"), Some("no-store"), "{path}");
        }
    }
    let missing = server.request("GET", "/assets/monitor/missing.js", &host, "");
    assert_eq!(missing.status, 404);
    assert_eq!(missing.header("cache-control"), Some("no-store"));
}

#[test]
fn monitor_events_emit_ready_and_react_to_the_shared_change_broadcast() {
    let home = home();
    let server = Running::start(home.path());
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(std::time::Duration::from_secs(3)))
        .build()
        .into();
    let mut response = agent
        .get(server.url("/monitor/api/events"))
        .header("Host", "monitor.example")
        .call()
        .unwrap();
    let mut reader = response.body_mut().as_reader();
    fn next_event(reader: &mut impl std::io::Read) -> String {
        let mut body = Vec::new();
        let mut byte = [0; 1];
        while !body.ends_with(b"\n\n") {
            reader.read_exact(&mut byte).unwrap();
            body.push(byte[0]);
        }
        String::from_utf8(body).unwrap()
    }
    assert!(next_event(&mut reader).contains("event: ready"));
    let files = agent_board::file_store::FileStore::open(&home.path().join("shared"));
    files.create_project("other", chrono::Utc::now()).unwrap();
    assert!(next_event(&mut reader).contains("event: changed"));
}
