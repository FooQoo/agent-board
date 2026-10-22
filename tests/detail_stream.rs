//! The Task Detail and Epic Detail routes of the PC server and of the monitor answer the NDJSON
//! contract (U4). Servers listen on port 0 in a temporary data directory.

mod common;
#[path = "support/mobile_monitor.rs"]
mod support;

use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use agent_board::domain::ProjectId;
use agent_board::file_store::detail::{epic_version, task_versions};
use agent_board::file_store::model::NewEpic;
use agent_board::file_store::{FileStore, TaskTextParts};
use agent_board::server::contracts::{
    DetailEvent, ResourceId, Section, StreamValidator, detail::DetailResource,
};
use serde_json::Value;

/// The two harnesses guard the process environment with separate locks, so the tests of this
/// file run one at a time.
static SERIAL: Mutex<()> = Mutex::new(());

fn project_id(home: &std::path::Path) -> ProjectId {
    FileStore::open(&home.join("shared"))
        .project_by_name("monitor")
        .unwrap()
        .id
}

fn store(home: &std::path::Path) -> FileStore {
    FileStore::open(&home.join("shared"))
}

/// Every line of a body as an event, checked against the order rules.
fn events_of(body: &str) -> Vec<DetailEvent> {
    assert!(body.ends_with('\n'), "the last line ends with a newline");
    let events: Vec<DetailEvent> = body
        .lines()
        .map(|line| serde_json::from_str(line).unwrap_or_else(|e| panic!("{e}: {line}")))
        .collect();
    let mut checker = StreamValidator::new();
    for event in &events {
        checker.accept(event).unwrap();
    }
    checker.finish().unwrap();
    events
}

fn error_code(body: &str) -> String {
    let value: Value = serde_json::from_str(body).unwrap_or_else(|_| panic!("not JSON: {body}"));
    value["error"]["code"].as_str().unwrap().to_string()
}

fn count(events: &[DetailEvent], f: impl Fn(&DetailEvent) -> bool) -> usize {
    events.iter().filter(|e| f(e)).count()
}

fn long_body(paragraphs: usize) -> String {
    (0..paragraphs)
        .map(|n| format!("## Part {n}\n\nParagraph {n} with words, `code`, and 日本語の文章。\n\n"))
        .collect()
}

#[test]
fn pc_task_detail_streams_ndjson_in_contract_order() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    let server = common::Running::start(home.path());
    let reply = server.get(&format!("/api/projects/{id}/tasks/1/detail"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert!(
        reply
            .header("content-type")
            .is_some_and(|v| v.starts_with("application/x-ndjson")),
        "{:?}",
        reply.header("content-type")
    );
    assert_eq!(reply.header("cache-control"), Some("no-store"));
    let events = events_of(&reply.body);
    let DetailEvent::Start {
        resource,
        id: rid,
        sections,
        ..
    } = &events[0]
    else {
        panic!()
    };
    assert_eq!(*resource, DetailResource::Task);
    assert_eq!(*rid, ResourceId::Task(1));
    assert_eq!(sections, &vec![Section::Document, Section::History]);
    assert!(count(&events, |e| matches!(e, DetailEvent::Block { .. })) > 0);
    assert!(count(&events, |e| matches!(e, DetailEvent::HistoryItem { .. })) > 0);
}

#[test]
fn pc_sections_pick_the_document_or_the_history() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    let server = common::Running::start(home.path());
    let base = format!("/api/projects/{id}/tasks/1/detail");
    let history = events_of(&server.get(&format!("{base}?sections=history")).body);
    assert_eq!(
        count(&history, |e| matches!(e, DetailEvent::Block { .. })),
        0
    );
    assert_eq!(
        count(&history, |e| matches!(e, DetailEvent::Acceptance { .. })),
        0
    );
    assert!(count(&history, |e| matches!(e, DetailEvent::HistoryItem { .. })) > 0);
    let document = events_of(&server.get(&format!("{base}?sections=document")).body);
    assert_eq!(
        count(&document, |e| matches!(e, DetailEvent::HistoryItem { .. })),
        0
    );
    assert!(count(&document, |e| matches!(e, DetailEvent::Block { .. })) > 0);
    let both = events_of(
        &server
            .get(&format!("{base}?sections=document,history"))
            .body,
    );
    assert_eq!(both.len(), events_of(&server.get(&base).body).len());
    let encoded = events_of(
        &server
            .get(&format!("{base}?sections=document%2Chistory"))
            .body,
    );
    assert_eq!(encoded.len(), both.len());
}

#[test]
fn pc_epic_detail_streams_the_document() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    store(home.path())
        .create_epic(
            &id,
            NewEpic {
                id: "ALPHA".into(),
                name: "Alpha".into(),
                color: Some("#7C3AED".into()),
                is_draft: false,
                document: Some("# Alpha\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nEnd.\n".into()),
            },
            chrono::Utc::now(),
        )
        .unwrap();
    let server = common::Running::start(home.path());
    let reply = server.get(&format!("/api/projects/{id}/epics/ALPHA/detail"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    let events = events_of(&reply.body);
    let DetailEvent::Start {
        resource,
        id: rid,
        sections,
        ..
    } = &events[0]
    else {
        panic!()
    };
    assert_eq!(*resource, DetailResource::Epic);
    assert_eq!(*rid, ResourceId::Epic("ALPHA".into()));
    assert_eq!(sections, &vec![Section::Document]);
    assert!(events.iter().any(|e| matches!(
        e,
        DetailEvent::Block {
            kind: agent_board::server::contracts::BlockKind::Mermaid,
            ..
        }
    )));
    let history = server.get(&format!(
        "/api/projects/{id}/epics/ALPHA/detail?sections=history"
    ));
    assert_eq!(history.status, 400, "{}", history.body);
    assert_eq!(error_code(&history.body), "invalid_sections");
}

#[test]
fn pc_versions_match_those_computed_from_the_stored_data() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    let files = store(home.path());
    files
        .create_epic(
            &id,
            NewEpic {
                id: "BETA".into(),
                name: "Beta".into(),
                color: Some("#7C3AED".into()),
                is_draft: false,
                document: Some("Doc.\n".into()),
            },
            chrono::Utc::now(),
        )
        .unwrap();
    let server = common::Running::start(home.path());
    let snapshot = files.snapshot(&id).unwrap();
    let expected = task_versions(&snapshot.tasks[0]);
    let events = events_of(
        &server
            .get(&format!("/api/projects/{id}/tasks/1/detail"))
            .body,
    );
    let (DetailEvent::Start { versions: a, .. }, DetailEvent::Complete { versions: b }) =
        (&events[0], events.last().unwrap())
    else {
        panic!()
    };
    assert_eq!(a, b);
    assert_eq!(a.document.as_deref(), Some(expected.document.as_str()));
    assert_eq!(a.history.as_deref(), Some(expected.history.as_str()));
    let epic = snapshot
        .epics
        .iter()
        .find(|e| e.id.as_str() == "BETA")
        .unwrap();
    let events = events_of(
        &server
            .get(&format!("/api/projects/{id}/epics/BETA/detail"))
            .body,
    );
    let DetailEvent::Start { versions, .. } = &events[0] else {
        panic!()
    };
    assert_eq!(
        versions.document.as_deref(),
        Some(epic_version(epic).as_str())
    );
}

#[test]
fn pc_unknown_targets_are_refused_before_any_stream() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    let server = common::Running::start(home.path());
    let cases = [
        (
            format!("/api/projects/{id}/tasks/99/detail"),
            "task_not_found",
        ),
        (
            format!("/api/projects/{id}/tasks/abc/detail"),
            "task_not_found",
        ),
        (
            format!("/api/projects/{id}/epics/NOPE/detail"),
            "epic_not_found",
        ),
        (
            format!("/api/projects/{}/tasks/1/detail", "0".repeat(32)),
            "project_not_found",
        ),
    ];
    for (path, code) in cases {
        let reply = server.get(&path);
        assert_eq!(reply.status, 404, "{path}: {}", reply.body);
        assert_eq!(error_code(&reply.body), code, "{path}");
        assert_eq!(reply.header("cache-control"), Some("no-store"), "{path}");
        assert!(!reply.body.contains("\"type\":\"start\""), "{path}");
    }
    let bad = server.get(&format!("/api/projects/{id}/tasks/99/detail?sections=body"));
    assert_eq!(bad.status, 400);
    assert_eq!(error_code(&bad.body), "invalid_sections");
}

#[test]
fn pc_a_stream_in_progress_keeps_one_version_and_never_blocks_a_write() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    let files = store(home.path());
    let big = long_body(600);
    files
        .edit_task_parts(
            &id,
            1,
            None,
            TaskTextParts {
                body: Some(&big),
                acceptance: None,
            },
            chrono::Utc::now(),
        )
        .unwrap();
    let server = common::Running::start(home.path());
    let before = task_versions(&files.snapshot(&id).unwrap().tasks[0]);
    let url = format!("http://{}/api/projects/{id}/tasks/1/detail", server.addr);
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .into();
    let mut response = agent.get(&url).call().unwrap();
    let mut reader = response.body_mut().as_reader();
    let mut head = vec![0u8; 512];
    reader.read_exact(&mut head).unwrap();

    // The response is half read. A write goes through at once and moves the document on.
    let started = Instant::now();
    files
        .edit_task_parts(
            &id,
            1,
            None,
            TaskTextParts {
                body: Some("Replaced while streaming.\n"),
                acceptance: None,
            },
            chrono::Utc::now(),
        )
        .unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "{:?}",
        started.elapsed()
    );

    let mut rest = Vec::new();
    reader.read_to_end(&mut rest).unwrap();
    head.extend(rest);
    let events = events_of(&String::from_utf8(head).unwrap());
    let (DetailEvent::Start { versions: a, .. }, DetailEvent::Complete { versions: b }) =
        (&events[0], events.last().unwrap())
    else {
        panic!()
    };
    assert_eq!(a, b);
    assert_eq!(a.document.as_deref(), Some(before.document.as_str()));
    let text: String = events
        .iter()
        .filter_map(|e| match e {
            DetailEvent::Block { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert!(text.contains("Part 599") && !text.contains("Replaced"));

    // The next request sees the new data, with another version.
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let events = events_of(
            &server
                .get(&format!("/api/projects/{id}/tasks/1/detail"))
                .body,
        );
        let DetailEvent::Start { versions, .. } = &events[0] else {
            panic!()
        };
        if versions.document.as_deref() != Some(before.document.as_str()) {
            break;
        }
        assert!(Instant::now() < deadline, "the server never saw the write");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn pc_a_client_that_leaves_early_does_not_hurt_the_server() {
    use std::io::Write;
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    let files = store(home.path());
    let big = long_body(600);
    files
        .edit_task_parts(
            &id,
            1,
            None,
            TaskTextParts {
                body: Some(&big),
                acceptance: None,
            },
            chrono::Utc::now(),
        )
        .unwrap();
    let server = common::Running::start(home.path());
    for _ in 0..5 {
        let mut socket = std::net::TcpStream::connect(server.addr).unwrap();
        write!(
            socket,
            "GET /api/projects/{id}/tasks/1/detail HTTP/1.1\r\nHost: {}\r\n\r\n",
            server.addr
        )
        .unwrap();
        let mut some = [0u8; 256];
        socket.read_exact(&mut some).unwrap();
        drop(socket);
    }
    let reply = server.get(&format!("/api/projects/{id}/tasks/1/detail"));
    assert_eq!(reply.status, 200);
    events_of(&reply.body);
    // Stopping waits for the server's tasks; it must return.
    let stopped = Instant::now();
    server.stop();
    assert!(stopped.elapsed() < Duration::from_secs(10));
}

#[test]
fn monitor_detail_routes_stream_the_same_contract_behind_a_session() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    let server = support::Running::start(home.path());
    let session = server.session();
    let base = format!("/monitor/api/projects/{id}");
    let reply = server.get(&session, &format!("{base}/tasks/1/detail"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.header("cache-control"), Some("no-store"));
    assert!(
        reply
            .header("content-type")
            .is_some_and(|v| v.starts_with("application/x-ndjson"))
    );
    let events = events_of(&reply.body);
    assert!(count(&events, |e| matches!(e, DetailEvent::Block { .. })) > 0);
    let history = events_of(
        &server
            .get(&session, &format!("{base}/tasks/1/detail?sections=history"))
            .body,
    );
    assert_eq!(
        count(&history, |e| matches!(e, DetailEvent::Block { .. })),
        0
    );

    let missing = server.get(&session, &format!("{base}/tasks/9/detail"));
    assert_eq!(missing.status, 404, "{}", missing.body);
    assert_eq!(error_code(&missing.body), "task_not_found");
    let epic = server.get(&session, &format!("{base}/epics/NOPE/detail"));
    assert_eq!(epic.status, 404, "{}", epic.body);
    assert_eq!(error_code(&epic.body), "epic_not_found");
    let bad = server.get(&session, &format!("{base}/tasks/1/detail?sections=x"));
    assert_eq!(bad.status, 400);
    assert_eq!(error_code(&bad.body), "invalid_sections");

    let refused = server
        .request("GET", &format!("{base}/board"), &[], "")
        .status;
    assert_ne!(refused, 200);
    let anonymous = server.request("GET", &format!("{base}/tasks/1/detail"), &[], "");
    assert_eq!(anonymous.status, refused);
}

#[test]
fn pc_an_epic_asks_for_the_document_only() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = support::home();
    let id = project_id(home.path());
    store(home.path())
        .create_epic(
            &id,
            NewEpic {
                id: "GAMMA".into(),
                name: "Gamma".into(),
                color: Some("#7C3AED".into()),
                is_draft: false,
                document: Some("Doc.\n".into()),
            },
            chrono::Utc::now(),
        )
        .unwrap();
    let server = common::Running::start(home.path());
    let base = format!("/api/projects/{id}/epics/GAMMA/detail");
    for query in ["", "?sections=document"] {
        let reply = server.get(&format!("{base}{query}"));
        assert_eq!(reply.status, 200, "{query}: {}", reply.body);
        events_of(&reply.body);
    }
    for query in ["?sections=history", "?sections=document,history"] {
        let reply = server.get(&format!("{base}{query}"));
        assert_eq!(reply.status, 400, "{query}: {}", reply.body);
        assert_eq!(error_code(&reply.body), "invalid_sections", "{query}");
    }
}
