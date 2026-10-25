//! The Docs routes are not on the mobile monitor's router.

#[path = "support/mobile_monitor.rs"]
mod support;

use support::{Running, home};

#[test]
fn the_monitor_router_has_no_docs_routes() {
    let home = home();
    let server = Running::start(home.path());
    let session = server.session();
    let project = "0123456789abcdef0123456789abcdef";
    for path in [
        format!("/monitor/api/projects/{project}/docs/tree"),
        format!("/monitor/api/projects/{project}/docs/file?path=a.md"),
        format!("/monitor/api/projects/{project}/docs/assets?path=a.png"),
        format!("/monitor/api/projects/{project}/docs/open"),
        format!("/api/projects/{project}/docs/tree"),
    ] {
        assert_eq!(server.get(&session, &path).status, 404, "{path}");
    }
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
