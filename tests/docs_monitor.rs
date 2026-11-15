//! The Docs routes through the ngrok entrance: the board's own project documents are served with a
//! session, the old monitor's paths still have none, and nothing that acts on the PC is served.

#[path = "support/mobile_monitor.rs"]
mod support;

use support::{Running, home};

#[test]
fn the_old_monitor_router_has_no_docs_routes() {
    let home = home();
    let server = Running::start(home.path());
    let session = server.session();
    let project = "0123456789abcdef0123456789abcdef";
    for path in [
        format!("/monitor/api/projects/{project}/docs/tree"),
        format!("/monitor/api/projects/{project}/docs/file?path=a.md"),
        format!("/monitor/api/projects/{project}/docs/assets?path=a.png"),
        format!("/monitor/api/projects/{project}/docs/open"),
    ] {
        assert_eq!(server.get(&session, &path).status, 404, "{path}");
    }
}

#[test]
fn the_project_docs_are_read_with_a_session_and_cannot_be_opened_on_the_pc() {
    let home = home();
    let server = Running::start(home.path());
    let session = server.session();
    let base = server.base(home.path());

    let tree = server.get(&session, &format!("{base}/docs/tree"));
    assert_eq!(tree.status, 200, "{}", tree.body);
    assert_eq!(
        server
            .request("GET", &format!("{base}/docs/tree"), &[], "")
            .status,
        401
    );
    // Opening a path acts on the PC itself, so it is not part of the entrance.
    let open = server.write(&session, "POST", &format!("{base}/docs/open"), "{}");
    assert_eq!(open.status, 404, "{}", open.body);
}

#[test]
fn the_monitor_router_has_no_docs_sandbox_page() {
    let home = home();
    let server = Running::start(home.path());
    let session = server.session();
    for path in [
        "/monitor/docs-sandbox",
        "/monitor/docs-sandbox/sandbox-x.js",
        "/monitor/assets/docs-sandbox",
    ] {
        assert_eq!(server.get(&session, path).status, 404, "{path}");
    }
}
