//! The Docs sandbox page: a page of its own that runs a document's MDX, with its own policy.

mod common;

use common::Running;

const SANDBOX_POLICY: &str = "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

fn running() -> (tempfile::TempDir, Running) {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    (home, server)
}

/// The script the page loads, as the path it names.
fn script_path(html: &str) -> String {
    let start = html
        .find("src=\"/docs-sandbox/")
        .expect("the page loads a script")
        + 5;
    let end = html[start..].find('"').unwrap() + start;
    html[start..end].to_string()
}

#[test]
fn the_sandbox_page_has_its_own_policy_and_no_board_content() {
    let (_home, server) = running();
    let page = server.get("/docs-sandbox");
    assert_eq!(page.status, 200);
    assert_eq!(page.header("content-security-policy"), Some(SANDBOX_POLICY));
    assert_eq!(page.header("x-content-type-options"), Some("nosniff"));
    assert!(page.body.contains("<div id=\"root\">"));
    assert!(!page.body.contains("agboard-token"));
    assert!(!page.body.contains(&server.token()));
}

#[test]
fn the_sandbox_script_is_served_by_name_only() {
    let (_home, server) = running();
    let page = server.get("/docs-sandbox");
    let script = server.get(&script_path(&page.body));
    assert_eq!(script.status, 200);
    assert_eq!(script.header("x-content-type-options"), Some("nosniff"));
    assert!(
        script
            .header("content-type")
            .is_some_and(|kind| kind.starts_with("text/javascript"))
    );
    assert_eq!(server.get("/docs-sandbox/missing.js").status, 404);
    assert_eq!(server.get("/docs-sandbox/..%2Findex.html").status, 404);
}

#[test]
fn the_board_page_does_not_carry_the_sandbox_policy() {
    let (_home, server) = running();
    let board = server.get("/");
    let policy = board.header("content-security-policy").unwrap();
    assert!(!policy.contains("unsafe-eval"));
    assert!(policy.contains("script-src 'self';"));
    assert!(policy.contains("frame-src 'self'"));
    assert_eq!(
        server
            .get("/assets/app.js")
            .header("content-security-policy"),
        None
    );
}
