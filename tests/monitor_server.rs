#[path = "support/mobile_monitor.rs"]
mod support;

use support::{Running, home};

#[test]
fn monitor_api_is_read_only_allowlisted_and_uses_the_shared_snapshot() {
    let home = home();
    let server = Running::start(home.path());
    let session = server.session();
    let base = server.monitor_base(home.path());
    let summary = server.get(&session, &format!("{base}/summary"));
    assert_eq!(summary.status, 200, "{}", summary.body);
    assert_eq!(summary.header("cache-control"), Some("no-store"));
    assert_eq!(summary.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(summary.header("referrer-policy"), Some("no-referrer"));
    assert!(summary.body.contains("Sample"));

    // The old whole-board reads are gone: a read finds no route, and a write is refused first.
    for path in [
        "/monitor/api/projects".to_string(),
        format!("{base}/board"),
        format!("{base}/epics"),
        format!("{base}/epics/ALPHA"),
    ] {
        assert_eq!(server.get(&session, &path).status, 404, "GET {path}");
        assert_eq!(
            server.write(&session, "POST", &path, "{}").status,
            405,
            "POST {path}"
        );
    }
    // The events stream follows one project: without `?project=` it is an error, not every project.
    let all = server.get(&session, "/monitor/api/events");
    assert_eq!(all.status, 422, "{}", all.body);

    for method in ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] {
        let result = server.write(&session, method, &format!("{base}/summary"), "{}");
        assert_eq!(result.status, 405, "{method}: {}", result.body);
        let unknown = server.write(&session, method, "/monitor/api/unknown", "");
        assert_eq!(unknown.status, 405, "{method}: {}", unknown.body);
    }
    for path in [
        "/monitor/api/health",
        "/monitor/api/notify",
        "/monitor/api/archive",
        "/monitor/api/projects/not-a-project/archive",
        "/monitor/assets/app.js",
    ] {
        assert_eq!(server.get(&session, path).status, 404, "{path}");
    }
    assert_eq!(server.request("GET", "/monitor", &[], "").status, 200);
    let html = server.request("GET", "/monitor/", &[], "");
    assert_eq!(html.status, 200);
    assert!(!html.body.contains("agboard-token"));
    assert_eq!(html.header("cache-control"), Some("no-store"));
}

#[test]
fn monitor_assets_are_cached_by_content_name_and_missing_files_are_not() {
    let home = home();
    let server = Running::start(home.path());
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("../web/dist/monitor/manifest.json")).unwrap();
    for asset in manifest["assets"].as_array().unwrap() {
        let name = asset["name"].as_str().unwrap();
        let path = format!("/monitor/assets/monitor/{name}");
        for method in ["GET", "HEAD"] {
            let response = server.request(method, &path, &[], "");
            assert_eq!(response.status, 200, "{method} {path}");
            assert_eq!(
                response.header("cache-control"),
                Some("public, max-age=31536000, immutable"),
                "{path}"
            );
            assert_eq!(response.header("vary"), Some("accept-encoding"), "{path}");
        }
    }
    for missing in ["missing.js", "index.html", "monitor.js", "manifest.json"] {
        let response = server.request(
            "GET",
            &format!("/monitor/assets/monitor/{missing}"),
            &[],
            "",
        );
        assert_eq!(response.status, 404, "{missing}");
        assert_eq!(
            response.header("cache-control"),
            Some("no-store"),
            "{missing}"
        );
    }
}

#[test]
fn monitor_events_emit_ready_and_react_to_the_shared_change_broadcast() {
    let home = home();
    let files = agent_board::file_store::FileStore::open(&home.path().join("shared"));
    let project = files.project_by_name("monitor").unwrap().id;
    let server = Running::start(home.path());
    let session = server.session();
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(std::time::Duration::from_secs(3)))
        .build()
        .into();
    let mut response = agent
        .get(server.url(&format!("/monitor/api/events?project={project}")))
        .header("Host", server.host())
        .header("Cookie", &session.cookie)
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
    let ready = next_event(&mut reader);
    assert!(ready.contains("event: ready"), "{ready}");
    assert!(
        ready.contains(&format!(
            r#"data: {{"build":"{}"}}"#,
            agent_board::server::web_assets::MONITOR_BUILD_ID
        )),
        "{ready}"
    );
    // The stream follows one project: a new project is not sent, a change of that project is.
    files.create_project("other", chrono::Utc::now()).unwrap();
    files
        .add_history(&project, 1, Some("A note."), chrono::Utc::now())
        .unwrap();
    let changed = next_event(&mut reader);
    assert!(changed.contains("event: changed"), "{changed}");
    assert!(changed.contains(project.as_str()), "{changed}");
}
