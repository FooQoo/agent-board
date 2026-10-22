//! The SSE `changed` event of the PC server and of the monitor: the contract payload, the
//! running number, and the monitor's project filter. Servers listen on port 0 in a temporary
//! data directory.

mod common;
#[path = "support/mobile_monitor.rs"]
mod support;

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use agent_board::domain::ProjectId;
use agent_board::file_store::FileStore;
use agent_board::server::contracts::{ChangeId, ChangeResource, Changed, Facet};
use chrono::Utc;

static SERIAL: Mutex<()> = Mutex::new(());

/// One server-sent event.
#[derive(Debug, Clone)]
struct Sse {
    name: String,
    data: String,
}

struct Stream {
    stream: TcpStream,
    buffer: String,
    /// Every event block received so far.
    log: String,
}

impl Stream {
    fn open(addr: SocketAddr, path: &str, extra_headers: &str) -> Stream {
        let mut stream = TcpStream::connect(addr).unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nAccept: text/event-stream\r\n{extra_headers}\r\n"
        )
        .unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(50)))
            .unwrap();
        let mut stream = Stream {
            stream,
            buffer: String::new(),
            log: String::new(),
        };
        let ready = stream.next(Duration::from_secs(5)).expect("ready");
        assert_eq!(ready.name, "ready", "{}", stream.buffer);
        stream
    }

    /// The next event within `within`, or `None`. Heartbeats and comments are skipped.
    fn next(&mut self, within: Duration) -> Option<Sse> {
        let deadline = Instant::now() + within;
        let mut chunk = [0u8; 4096];
        loop {
            if let Some(event) = self.take_event() {
                return Some(event);
            }
            if Instant::now() >= deadline {
                return None;
            }
            match self.stream.read(&mut chunk) {
                Ok(0) => return None,
                Ok(n) => self.buffer.push_str(&String::from_utf8_lossy(&chunk[..n])),
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(e) => panic!("read failed: {e}"),
            }
        }
    }

    fn take_event(&mut self) -> Option<Sse> {
        loop {
            let end = self.buffer.find("\n\n")?;
            let block: String = self.buffer.drain(..end + 2).collect();
            self.log.push_str(&block);
            let mut name = None;
            let mut data = String::new();
            for line in block.lines() {
                if let Some(value) = line.strip_prefix("event:") {
                    name = Some(value.trim().to_string());
                } else if let Some(value) = line.strip_prefix("data:") {
                    data.push_str(value.trim());
                }
            }
            if let Some(name) = name
                && name != "heartbeat"
            {
                return Some(Sse { name, data });
            }
        }
    }

    /// The next `changed`, parsed. Other events are skipped.
    fn changed(&mut self, within: Duration) -> Option<Changed> {
        let deadline = Instant::now() + within;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let event = self.next(left)?;
            if event.name == "changed" {
                let changed: Changed = serde_json::from_str(&event.data)
                    .unwrap_or_else(|e| panic!("{e}: {}", event.data));
                assert_eq!(changed.problem(), None, "{}", event.data);
                return Some(changed);
            }
        }
    }
}

fn store(home: &std::path::Path) -> FileStore {
    FileStore::open(&home.join("shared"))
}

fn project_of(home: &std::path::Path, name: &str) -> ProjectId {
    store(home).project_by_name(name).unwrap().id
}

fn note(home: &std::path::Path, project: &ProjectId, text: &str) {
    store(home)
        .add_history(project, 1, Some(text), Utc::now())
        .unwrap();
}

const WAIT: Duration = Duration::from_secs(5);

#[test]
fn events_pc_changed_has_the_project_the_changes_the_instance_and_a_growing_seq() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let project = project_of(home.path(), "monitor");
    let server = common::Running::start(home.path());
    let mut events = Stream::open(
        server.addr,
        "/api/events",
        &format!("Host: {}\r\n", server.addr),
    );

    note(home.path(), &project, "First note.");
    let first = events.changed(WAIT).expect("a changed event");
    assert!(!first.instance_id.is_empty());
    assert_eq!(first.seq, 1);
    assert_eq!(first.project_id, project.to_string());
    let task = first
        .changes
        .iter()
        .find(|c| c.resource == ChangeResource::Task && c.id == ChangeId::Task(1))
        .expect("task 1");
    assert!(task.facets.contains(&Facet::History), "{:?}", task.facets);
    assert!(!task.facets.contains(&Facet::Document), "{:?}", task.facets);

    note(home.path(), &project, "Second note.");
    let second = events.changed(WAIT).expect("a second changed event");
    assert_eq!(second.seq, 2);
    assert_eq!(second.instance_id, first.instance_id);

    // The PC stream carries every project, so another project's change is seen as well, and a
    // new project is a `project` resource.
    let other = store(home.path())
        .create_project("Other", Utc::now())
        .unwrap()
        .id;
    let third = events.changed(WAIT).expect("the new project");
    assert_eq!(third.seq, 3);
    assert_eq!(third.project_id, other.to_string());
    assert_eq!(third.changes[0].resource, ChangeResource::Project);
    assert_eq!(third.changes[0].facets, vec![Facet::Summary]);
}

#[test]
fn events_two_starts_have_different_instance_ids_and_each_starts_at_seq_one() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let project = project_of(home.path(), "monitor");
    let mut seen = Vec::new();
    for round in 0..2 {
        let server = common::Running::start(home.path());
        let mut events = Stream::open(
            server.addr,
            "/api/events",
            &format!("Host: {}\r\n", server.addr),
        );
        note(home.path(), &project, &format!("Note {round}."));
        let changed = events.changed(WAIT).expect("a changed event");
        assert_eq!(changed.seq, 1);
        seen.push(changed.instance_id);
    }
    assert_ne!(seen[0], seen[1]);
}

fn monitor_stream(server: &support::Running, session: &support::Session, query: &str) -> Stream {
    Stream::open(
        server.backend,
        &format!("/monitor/api/events{query}"),
        &format!("Host: {}\r\nCookie: {}\r\n", server.host(), session.cookie),
    )
}

#[test]
fn events_monitor_needs_an_existing_project_in_the_query() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let server = support::Running::start(home.path());
    let session = server.session();
    for (query, status, code) in [
        ("", 422, "invalid_value"),
        ("?project=", 422, "invalid_value"),
        ("?other=1", 422, "invalid_value"),
        ("?project=not-an-id", 422, "invalid_value"),
        (
            "?project=ffffffffffffffffffffffffffffffff",
            404,
            "project_not_found",
        ),
    ] {
        let reply = server.get(&session, &format!("/monitor/api/events{query}"));
        assert_eq!(reply.status, status, "{query}: {}", reply.body);
        let body: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
        assert_eq!(body["error"]["code"], code, "{query}");
        assert!(
            !reply
                .header("content-type")
                .unwrap_or_default()
                .contains("event-stream"),
            "{query}"
        );
    }
}

#[test]
fn events_monitor_sends_only_the_changes_of_the_followed_project() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let followed = project_of(home.path(), "monitor");
    let files = store(home.path());
    let other = files.create_project("Other", Utc::now()).unwrap().id;
    files
        .create_task(
            &other,
            agent_board::domain::NewTask {
                title: "Elsewhere".into(),
                description: String::new(),
                assignee: agent_board::domain::Assignee::Ai,
                actor: agent_board::domain::Actor::Human,
                is_draft: false,
            },
            Utc::now(),
        )
        .unwrap();
    let server = support::Running::start(home.path());
    let session = server.session();
    let mut events = monitor_stream(&server, &session, &format!("?project={followed}"));

    // A change of the other project, and a new project, come first. Neither is sent.
    note(home.path(), &other, "Elsewhere note.");
    files.create_project("Third", Utc::now()).unwrap();
    std::thread::sleep(Duration::from_millis(700));
    note(home.path(), &followed, "Followed note.");

    let first = events.changed(WAIT).expect("the followed change");
    assert_eq!(first.project_id, followed.to_string());
    assert_eq!(first.seq, 1, "the numbers count this stream's events");
    assert!(
        first
            .changes
            .iter()
            .all(|change| change.resource != ChangeResource::Project)
    );
    assert!(!events.log.contains(other.as_str()), "{}", events.log);

    note(home.path(), &followed, "Another note.");
    let second = events.changed(WAIT).expect("a second change");
    assert_eq!(second.seq, 2);
    assert_eq!(second.instance_id, first.instance_id);
    assert!(events.changed(Duration::from_millis(600)).is_none());
}
