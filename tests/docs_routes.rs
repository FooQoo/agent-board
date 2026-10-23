//! The Docs routes on the board router: read-only, the write guard on opening, and bad input
//! refused first.

mod common;

use common::Running;

const PROJECT: &str = "0123456789abcdef0123456789abcdef";

fn running() -> (tempfile::TempDir, Running) {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    (home, server)
}

fn docs(path: &str) -> String {
    format!("/api/projects/{PROJECT}/docs/{path}")
}

#[test]
fn the_docs_cannot_be_written() {
    let (_home, server) = running();
    let body = r#"{"path":"a.md","content":"x","expectedRevision":"sha256:0"}"#;
    let reply = server.write("PUT", &docs("file"), Some(body));
    assert_eq!(reply.status, 405, "{}", reply.body);
}

#[test]
fn bad_input_is_refused_before_the_routes_do_anything() {
    let (_home, server) = running();
    for (path, code, status) in [
        (docs("file?path=../x.md"), "docs_path_invalid", 400),
        (docs("file?path=/x.md"), "docs_path_invalid", 400),
        (docs("file"), "docs_path_invalid", 400),
        (docs("file?path=x.txt"), "docs_not_markdown", 415),
        (docs("assets?path=.git/a.png"), "docs_path_invalid", 400),
        (
            "/api/projects/not-an-id/docs/tree".to_string(),
            "invalid_value",
            422,
        ),
    ] {
        let reply = server.get(&path);
        assert_eq!(
            (reply.status, reply.code()),
            (status, code.to_string()),
            "{path}"
        );
    }
}

#[test]
fn opening_the_folder_is_behind_the_write_guard_and_needs_a_project() {
    let (_home, server) = running();
    let path = docs("open");
    let no_headers = server.request("POST", &path, None, &[], None);
    assert_eq!(no_headers.status, 403, "{}", no_headers.body);
    let mut headers = server.page_headers(&server.token());
    headers[0].1 = "http://evil.example".into();
    let foreign = server.request("POST", &path, None, &headers, None);
    assert_eq!(foreign.status, 403, "{}", foreign.body);
    let missing = server.write("POST", &path, None);
    assert_eq!(
        (missing.status, missing.code()),
        (404, "project_not_found".into())
    );
}

/// Opening a file checks its path like a read, before anything is started. A
/// successful open would start an app on this computer, so it is not called here.
#[test]
fn opening_a_file_checks_its_path_first() {
    let home = tempfile::tempdir().unwrap();
    common::demo_project(home.path());
    let id =
        common::json_ok(home.path(), &["--project", "Demo", "workspace", "--json"])["projectId"]
            .as_str()
            .unwrap()
            .to_string();
    let server = Running::start(home.path());
    let open = |path: &str| {
        server.write(
            "POST",
            &format!("/api/projects/{id}/docs/open?path={path}"),
            None,
        )
    };
    for (path, status, code) in [
        ("..%2Fx.md", 400, "docs_path_invalid"),
        ("%2Fetc%2Fpasswd", 400, "docs_path_invalid"),
        ("missing.md", 404, "docs_not_found"),
    ] {
        let reply = open(path);
        assert_eq!(
            (reply.status, reply.code()),
            (status, code.to_string()),
            "{path}"
        );
    }
}
