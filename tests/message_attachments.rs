//! `GET /api/projects/{id}/messages/{id}/attachments/{name}`: the images sent with a request are
//! read back by name, and nothing outside `attachments/` can be read through the route. Every
//! test uses a temporary data area; servers listen on port 0.

mod common;

use agent_board::file_store::{FileStore, RequestImage, SendRequestInput};
use chrono::{TimeZone, Utc};
use common::{Running, png};

struct Fx {
    _home: tempfile::TempDir,
    server: Running,
    base: String,
    dir: std::path::PathBuf,
}

fn fx() -> Fx {
    let home = tempfile::tempdir().unwrap();
    let store = FileStore::open(&home.path().join("shared"));
    let now = Utc.with_ymd_and_hms(2026, 11, 17, 9, 0, 0).unwrap();
    let project = store.create_project("Alpha", now).unwrap().id;
    let sent = store
        .send_request(
            &project,
            SendRequestInput {
                text: "See ![screen](attachments/screen.png)".into(),
                images: vec![RequestImage {
                    name: "screen.png".into(),
                    bytes: png(),
                }],
            },
            now,
        )
        .unwrap();
    assert_eq!(sent.id, "Q-1");
    let dir = home
        .path()
        .join("shared/projects")
        .join(project.to_string())
        .join("qa/Q-1");
    let server = Running::start(home.path());
    Fx {
        base: format!("/api/projects/{project}/messages"),
        server,
        dir,
        _home: home,
    }
}

#[test]
fn message_attachment_serves_the_image_of_a_request() {
    let f = fx();
    let reply = f
        .server
        .get(&format!("{}/Q-1/attachments/screen.png", f.base));
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.header("content-type"), Some("image/png"));
    assert_eq!(reply.header("cache-control"), Some("no-store"));
    assert_eq!(reply.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(reply.bytes, png());
    f.server.stop();
}

#[test]
fn message_attachment_refuses_traversal_and_other_files() {
    let f = fx();
    for name in [
        "..%2FQA.md",
        "%2e%2e%2fQA.md",
        "..%2F..%2F..%2Fproject.json",
        "%2Fetc%2Fpasswd",
        "..%5CQA.md",
        ".hidden",
    ] {
        let reply = f.server.get(&format!("{}/Q-1/attachments/{name}", f.base));
        assert_eq!(reply.status, 404, "{name}: {}", reply.body);
        assert_eq!(reply.code(), "attachment_not_found", "{name}");
    }
    // A file in the folder that is not an image is not served either.
    std::fs::write(f.dir.join("attachments/note.txt"), b"secret").unwrap();
    let reply = f
        .server
        .get(&format!("{}/Q-1/attachments/note.txt", f.base));
    assert_eq!(reply.status, 404, "{}", reply.body);
    f.server.stop();
}

#[test]
fn message_attachment_is_not_found_for_a_missing_file_or_message() {
    let f = fx();
    let reply = f
        .server
        .get(&format!("{}/Q-1/attachments/none.png", f.base));
    assert_eq!(reply.status, 404);
    assert_eq!(reply.code(), "attachment_not_found");
    for id in ["Q-9", "nonsense"] {
        let reply = f
            .server
            .get(&format!("{}/{id}/attachments/screen.png", f.base));
        assert_eq!(reply.status, 404, "{id}");
        assert_eq!(reply.code(), "message_not_found", "{id}");
    }
    f.server.stop();
}

#[cfg(unix)]
#[test]
fn message_attachment_refuses_a_symbolic_link() {
    let f = fx();
    std::os::unix::fs::symlink(f.dir.join("QA.md"), f.dir.join("attachments/link.png")).unwrap();
    let reply = f
        .server
        .get(&format!("{}/Q-1/attachments/link.png", f.base));
    assert_eq!(reply.status, 404, "{}", reply.body);
    f.server.stop();
}
