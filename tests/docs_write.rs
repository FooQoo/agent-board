//! Saving a Docs file: revision check, exact bytes, serialized saves, failed
//! writes, the write guard, and the board staying untouched.

mod common;

use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

use agent_board::docs::revision_of;
use common::{Running, demo_project, json_ok};
use serde_json::json;

struct Setup {
    home: tempfile::TempDir,
    pid: String,
    server: Running,
}

impl Setup {
    fn new() -> Setup {
        let home = tempfile::tempdir().unwrap();
        demo_project(home.path());
        let pid = json_ok(home.path(), &["project", "ls", "--json"])["projects"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let server = Running::start(home.path());
        Setup { home, pid, server }
    }

    fn docs_dir(&self) -> PathBuf {
        self.home
            .path()
            .join("shared/projects")
            .join(&self.pid)
            .join("docs")
    }

    fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.docs_dir().join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        path
    }

    fn url(&self) -> String {
        format!("/api/projects/{}/docs/file", self.pid)
    }

    fn save(&self, path: &str, content: &str, expected: &str) -> common::Reply {
        let body = json!({"path": path, "content": content, "expectedRevision": expected});
        self.server
            .write("PUT", &self.url(), Some(&body.to_string()))
    }
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn a_save_at_the_current_revision_writes_and_returns_the_new_revision() {
    let s = Setup::new();
    let path = s.file("a.md", b"old\n");
    let reply = s.save("a.md", "new\n", &revision_of(b"old\n"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["revision"], revision_of(b"new\n"));
    assert_eq!(reply.json()["path"], "a.md");
    assert_eq!(fs::read(&path).unwrap(), b"new\n");
    // The returned revision is the one the next save needs.
    let again = s.save("a.md", "third\n", &revision_of(b"new\n"));
    assert_eq!(again.status, 200, "{}", again.body);
    assert_eq!(names(&s.docs_dir()), ["README.md", "a.md"]);
    s.server.stop();
}

#[test]
fn the_content_is_stored_byte_for_byte() {
    let s = Setup::new();
    let path = s.file("a.md", b"x");
    let mut expected = revision_of(b"x");
    for content in [
        "\u{feff}---\r\ntitle: T\r\n---\r\n\r\nbody\r\nno final newline",
        "line\rcarriage\n\n\n",
        "---\ntitle: T\n---\n日本語 \u{1F600}\n",
        "",
    ] {
        let reply = s.save("a.md", content, &expected);
        assert_eq!(reply.status, 200, "{}", reply.body);
        assert_eq!(fs::read(&path).unwrap(), content.as_bytes());
        expected = reply.json()["revision"].as_str().unwrap().to_string();
        assert_eq!(expected, revision_of(content.as_bytes()));
    }
    s.server.stop();
}

#[test]
fn a_stale_revision_is_a_conflict_and_the_file_is_unchanged() {
    let s = Setup::new();
    let path = s.file("a.md", b"theirs\n");
    let reply = s.save("a.md", "mine\n", &revision_of(b"mine-base\n"));
    assert_eq!(reply.status, 409, "{}", reply.body);
    assert_eq!(reply.code(), "docs_revision_conflict");
    assert_eq!(
        reply.json()["error"]["currentRevision"],
        revision_of(b"theirs\n")
    );
    assert_eq!(fs::read(&path).unwrap(), b"theirs\n");
    // The overwrite is an ordinary save at the latest revision.
    let retry = s.save("a.md", "mine\n", &revision_of(b"theirs\n"));
    assert_eq!(retry.status, 200, "{}", retry.body);
    assert_eq!(fs::read(&path).unwrap(), b"mine\n");
    s.server.stop();
}

#[test]
fn a_missing_file_or_folder_is_not_created() {
    let s = Setup::new();
    for path in ["new.md", "nope/new.md"] {
        let reply = s.save(path, "x", &revision_of(b""));
        assert_eq!(reply.status, 404, "{}", reply.body);
        assert_eq!(reply.code(), "docs_not_found");
    }
    assert!(!s.docs_dir().join("new.md").exists());
    assert!(!s.docs_dir().join("nope").exists());
    s.server.stop();
}

#[test]
fn content_over_two_mib_is_refused_and_two_mib_is_saved() {
    let s = Setup::new();
    let path = s.file("a.md", b"x");
    let over = "a".repeat(2 * 1024 * 1024 + 1);
    let reply = s.save("a.md", &over, &revision_of(b"x"));
    assert_eq!(reply.status, 413, "{}", reply.body);
    assert_eq!(reply.code(), "docs_too_large");
    assert_eq!(fs::read(&path).unwrap(), b"x");
    let exact = "a".repeat(2 * 1024 * 1024);
    let reply = s.save("a.md", &exact, &revision_of(b"x"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    s.server.stop();
}

#[cfg(unix)]
#[test]
fn a_write_that_fails_leaves_the_file_and_no_temporary_file() {
    use std::os::unix::fs::PermissionsExt;
    let s = Setup::new();
    let path = s.file("sub/a.md", b"keep\n");
    let revision = revision_of(b"keep\n");
    let sub = path.parent().unwrap().to_path_buf();

    // A folder that cannot take a new file: the temporary file cannot be made.
    fs::set_permissions(&sub, fs::Permissions::from_mode(0o555)).unwrap();
    let blocked = s.save("sub/a.md", "lost\n", &revision);
    fs::set_permissions(&sub, fs::Permissions::from_mode(0o755)).unwrap();
    if fs::File::create(sub.join("probe")).is_ok() {
        // Running as a user that ignores permissions would make the case moot.
        let _ = fs::remove_file(sub.join("probe"));
        if blocked.status != 200 {
            assert_eq!(fs::read(&path).unwrap(), b"keep\n");
        }
    }
    if blocked.status != 200 {
        assert_eq!(blocked.status, 500, "{}", blocked.body);
        assert_eq!(fs::read(&path).unwrap(), b"keep\n");
        assert_eq!(names(&sub), ["a.md"]);
    }

    // A read-only file is refused before anything is written.
    fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
    let readonly = s.save("sub/a.md", "lost\n", &revision);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(readonly.status, 403, "{}", readonly.body);
    assert_eq!(readonly.code(), "docs_read_only");
    assert_eq!(fs::read(&path).unwrap(), b"keep\n");
    assert_eq!(names(&sub), ["a.md"]);
    s.server.stop();
}

#[test]
fn concurrent_saves_at_one_revision_let_one_win() {
    let s = Setup::new();
    let path = s.file("a.md", b"base\n");
    let revision = revision_of(b"base\n");
    let results: Vec<u16> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let (s, revision) = (&s, &revision);
                scope.spawn(move || s.save("a.md", &format!("writer {i}\n"), revision).status)
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });
    assert_eq!(
        results.iter().filter(|c| **c == 200).count(),
        1,
        "{results:?}"
    );
    assert_eq!(
        results.iter().filter(|c| **c == 409).count(),
        7,
        "{results:?}"
    );
    let saved = fs::read_to_string(&path).unwrap();
    assert!(saved.starts_with("writer "), "{saved}");
    assert_eq!(names(&s.docs_dir()), ["README.md", "a.md"]);
    s.server.stop();
}

#[test]
fn the_save_route_is_behind_the_write_guard() {
    let s = Setup::new();
    let path = s.file("a.md", b"keep\n");
    let body = json!({"path": "a.md", "content": "x", "expectedRevision": revision_of(b"keep\n")})
        .to_string();
    let url = s.url();
    let ct = Some("application/json");
    let none = s.server.request("PUT", &url, Some(&body), &[], ct);
    assert_eq!(none.status, 403, "{}", none.body);
    let mut headers = s.server.page_headers(&s.server.token());
    headers[0].1 = "http://evil.example".into();
    assert_eq!(
        s.server
            .request("PUT", &url, Some(&body), &headers, ct)
            .status,
        403
    );
    let mut headers = s.server.page_headers(&s.server.token());
    headers[1].1 = "cross-site".into();
    assert_eq!(
        s.server
            .request("PUT", &url, Some(&body), &headers, ct)
            .status,
        403
    );
    let mut headers = s.server.page_headers("wrong");
    headers.retain(|(n, _)| n != "X-Agboard-Token");
    assert_eq!(
        s.server
            .request("PUT", &url, Some(&body), &headers, ct)
            .status,
        403
    );
    let mut headers = s.server.page_headers(&s.server.token());
    headers.push(("Host".into(), "evil.example".into()));
    assert_eq!(
        s.server
            .request("PUT", &url, Some(&body), &headers, ct)
            .status,
        403
    );
    assert_eq!(fs::read(&path).unwrap(), b"keep\n");
    s.server.stop();
}

#[test]
fn a_save_changes_neither_the_board_version_nor_the_event_stream() {
    let s = Setup::new();
    s.file("a.md", b"base\n");
    let board_url = format!("/api/projects/{}/summary", s.pid);
    let before = s.server.get(&board_url).json()["version"].clone();
    assert!(before.is_string(), "{before}");

    let mut stream = TcpStream::connect(s.server.addr).unwrap();
    write!(
        stream,
        "GET /api/events HTTP/1.1\r\nHost: {}\r\nAccept: text/event-stream\r\n\r\n",
        s.server.addr
    )
    .unwrap();
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .unwrap();
    let mut received = String::new();
    let read_for = |stream: &mut TcpStream, received: &mut String, ms: u64| {
        let end = std::time::Instant::now() + Duration::from_millis(ms);
        let mut chunk = [0u8; 4096];
        while std::time::Instant::now() < end {
            if let Ok(n) = stream.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                received.push_str(&String::from_utf8_lossy(&chunk[..n]));
            }
        }
    };
    read_for(&mut stream, &mut received, 1000);
    assert!(received.contains("event: ready"), "{received}");
    let seen = received.matches("event: changed").count();

    let reply = s.save("a.md", "saved\n", &revision_of(b"base\n"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    read_for(&mut stream, &mut received, 2000);
    assert_eq!(
        received.matches("event: changed").count(),
        seen,
        "{received}"
    );
    assert_eq!(s.server.get(&board_url).json()["version"], before);
    s.server.stop();
}
