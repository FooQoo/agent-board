//! The Docs routes on the board router: the write guard and bad input refused first.

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

#[test]
fn the_save_route_is_behind_the_write_guard() {
    let (_home, server) = running();
    let body = r#"{"path":"a.md","content":"x","expectedRevision":"sha256:0"}"#;
    let path = docs("file");
    let no_headers = server.request("PUT", &path, Some(body), &[], Some("application/json"));
    assert_eq!(no_headers.status, 403, "{}", no_headers.body);
    let mut headers = server.page_headers(&server.token());
    headers[0].1 = "http://evil.example".into();
    let foreign = server.request("PUT", &path, Some(body), &headers, Some("application/json"));
    assert_eq!(foreign.status, 403, "{}", foreign.body);
    let mut headers = server.page_headers("wrong");
    headers.retain(|(name, _)| name != "X-Agboard-Token");
    let no_token = server.request("PUT", &path, Some(body), &headers, Some("application/json"));
    assert_eq!(no_token.status, 403, "{}", no_token.body);
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
    let body = r#"{"path":"../x.md","content":"x","expectedRevision":"sha256:0"}"#;
    let reply = server.write("PUT", &docs("file"), Some(body));
    assert_eq!(
        (reply.status, reply.code()),
        (400, "docs_path_invalid".into())
    );
}
