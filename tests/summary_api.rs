//! `GET .../summary` on the PC server and on the monitor: the contract shape, the key allowlist,
//! the version, `ETag` / `If-None-Match`, and the errors. Servers listen on port 0 in a
//! temporary data directory.

mod common;
#[path = "support/mobile_monitor.rs"]
mod support;

use std::collections::BTreeSet;
use std::sync::Mutex;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId};
use agent_board::file_store::frontmatter::AcceptanceItem;
use agent_board::file_store::model::NewEpic;
use agent_board::file_store::validate::EpicId;
use agent_board::file_store::{FileStore, TaskTextParts};
use agent_board::server::contracts::Summary;
use chrono::{TimeZone, Utc};
use serde_json::Value;

/// The two harnesses guard the process environment with separate locks, so the tests of this
/// file run one at a time.
static SERIAL: Mutex<()> = Mutex::new(());

fn at(minute: i64) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 10, 1, 0, 0).unwrap() + chrono::Duration::minutes(minute)
}

/// A project with an epic, task 1 (Doing, in the epic, with a body), and task 2 (archived).
fn home() -> (tempfile::TempDir, ProjectId) {
    let home = tempfile::tempdir().unwrap();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.create_project("Alpha", at(0)).unwrap().id;
    store
        .create_epic(
            &project,
            NewEpic {
                id: "ALPHA".into(),
                name: "Alpha epic".into(),
                color: Some("#336699".into()),
                is_draft: false,
                document: Some("# Alpha\n\nSecret epic document text.\n".into()),
            },
            at(1),
        )
        .unwrap();
    for title in ["First", "Second"] {
        store
            .create_task(
                &project,
                NewTask {
                    title: title.into(),
                    description: common::BODY.into(),
                    assignee: Assignee::Ai,
                    actor: Actor::Human,
                    is_draft: false,
                },
                at(2),
            )
            .unwrap();
    }
    store
        .move_work_task(
            &project,
            1,
            Column::Doing,
            ChangeContext {
                actor: Actor::Ai,
                reason: "Start.".into(),
            },
            at(3),
        )
        .unwrap();
    store
        .set_task_epic(
            &project,
            1,
            Some(&EpicId::normalize("ALPHA").unwrap()),
            Actor::Human,
            at(4),
        )
        .unwrap();
    let items = vec![AcceptanceItem {
        id: "AC-1".into(),
        text: "Verify it".into(),
        done: false,
    }];
    store
        .edit_task_parts(
            &project,
            1,
            None,
            TaskTextParts {
                body: None,
                acceptance: Some(&items),
            },
            at(5),
        )
        .unwrap();
    store.archive_task(&project, 2, at(6)).unwrap();
    (home, project)
}

fn keys(value: &Value) -> BTreeSet<String> {
    value.as_object().unwrap().keys().cloned().collect()
}

fn set(names: &[&str]) -> BTreeSet<String> {
    names.iter().map(|n| n.to_string()).collect()
}

/// The shape every Summary response must have, whichever server answered.
fn check_summary(body: &str, project: &ProjectId) -> Summary {
    // The typed contract refuses unknown fields; the allowlist below also pins the names.
    let summary: Summary = serde_json::from_str(body).unwrap_or_else(|e| panic!("{e}: {body}"));
    let value: Value = serde_json::from_str(body).unwrap();
    assert_eq!(
        keys(&value),
        set(&["project", "version", "tasks", "epics", "problems"])
    );
    assert_eq!(keys(&value["project"]), set(&["id", "name"]));
    for task in value["tasks"].as_array().unwrap() {
        assert_eq!(
            keys(task),
            set(&[
                "id",
                "title",
                "taskStatus",
                "agentStatus",
                "assignee",
                "isDraft",
                "position",
                "epicId",
                "acceptance",
                "updatedAt",
                "pendingRequestId",
                "pendingReason",
                "pendingChoices",
                "taskStatusChangedAt",
                "agentStatusChangedAt",
                "detailVersions",
            ])
        );
        assert_eq!(keys(&task["detailVersions"]), set(&["document", "history"]));
        assert_eq!(keys(&task["acceptance"]), set(&["done", "total"]));
    }
    for epic in value["epics"].as_array().unwrap() {
        assert_eq!(
            keys(epic),
            set(&[
                "id",
                "name",
                "color",
                "isDraft",
                "progress",
                "detailVersions"
            ])
        );
        assert_eq!(keys(&epic["detailVersions"]), set(&["document"]));
    }
    // Nothing that is read only when a card opens: no body, no acceptance text, no history, no
    // epic document.
    for text in ["Details", "Secret epic document", "Verify it", "Start."] {
        assert!(!body.contains(text), "{text} is in the Summary: {body}");
    }
    assert_eq!(summary.project.id, project.to_string());
    summary
}

fn check_content(summary: &Summary) {
    assert_eq!(summary.project.name, "Alpha");
    assert_eq!(summary.version.len(), 32);
    // The archived task is not listed; the epic counts it.
    assert_eq!(summary.tasks.len(), 1);
    let task = &summary.tasks[0];
    assert_eq!(task.id, 1);
    assert_eq!(task.title, "First");
    assert_eq!(task.task_status, Column::Doing);
    assert_eq!(task.epic_id.as_deref(), Some("ALPHA"));
    assert_eq!(task.acceptance.total, 1);
    assert_eq!(task.acceptance.done, 0);
    assert_eq!(task.detail_versions.document.len(), 32);
    assert_eq!(task.detail_versions.history.len(), 32);
    assert_ne!(task.detail_versions.document, task.detail_versions.history);
    // The server also seeds the default epics into a project that never had them.
    let epic = summary
        .epics
        .iter()
        .find(|epic| epic.id == "ALPHA")
        .expect("the epic");
    assert_eq!(epic.name, "Alpha epic");
    assert_eq!(epic.color, "#336699");
    assert_eq!(epic.progress.doing, 1);
    assert_eq!(epic.progress.total, 1);
    assert_eq!(epic.detail_versions.document.len(), 32);
}

#[test]
fn summary_pc_answers_the_contract_without_any_full_text() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let (home, project) = home();
    let server = common::Running::start(home.path());
    let reply = server.get(&format!("/api/projects/{project}/summary"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.header("content-type"), Some("application/json"));
    assert_eq!(reply.header("cache-control"), Some("no-store"));
    let summary = check_summary(&reply.body, &project);
    check_content(&summary);
    assert_eq!(
        reply.header("etag"),
        Some(format!("\"{}\"", summary.version).as_str())
    );
}

#[test]
fn summary_pc_if_none_match_gets_304_and_a_stale_tag_gets_the_body() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let (home, project) = home();
    let server = common::Running::start(home.path());
    let path = format!("/api/projects/{project}/summary");
    let first = server.get(&path);
    let etag = first.header("etag").unwrap().to_string();

    let same = server.request(
        "GET",
        &path,
        None,
        &[("If-None-Match".into(), etag.clone())],
        None,
    );
    assert_eq!(same.status, 304, "{}", same.body);
    assert!(same.body.is_empty());
    assert_eq!(same.header("etag"), Some(etag.as_str()));

    // A weak form and a list that contains the tag match as well; `*` matches anything.
    for value in [
        format!("W/{etag}"),
        format!("\"other\", {etag}"),
        "*".into(),
    ] {
        let reply = server.request(
            "GET",
            &path,
            None,
            &[("If-None-Match".into(), value.clone())],
            None,
        );
        assert_eq!(reply.status, 304, "{value}");
    }

    let stale = server.request(
        "GET",
        &path,
        None,
        &[("If-None-Match".into(), "\"0000\"".into())],
        None,
    );
    assert_eq!(stale.status, 200);
    assert_eq!(stale.body, first.body);
}

#[test]
fn summary_pc_follows_a_change_with_a_new_version() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let (home, project) = home();
    let server = common::Running::start(home.path());
    let path = format!("/api/projects/{project}/summary");
    let before: Summary = serde_json::from_str(&server.get(&path).body).unwrap();

    FileStore::open(&home.path().join("shared"))
        .add_history(&project, 1, Some("A note."), at(10))
        .unwrap();
    // The watcher reads the change after its debounce.
    let mut after = None;
    for _ in 0..60 {
        let summary: Summary = serde_json::from_str(&server.get(&path).body).unwrap();
        if summary.version != before.version {
            after = Some(summary);
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let after = after.expect("the Summary version moved");
    let (b, a) = (&before.tasks[0], &after.tasks[0]);
    assert_eq!(a.detail_versions.document, b.detail_versions.document);
    assert_ne!(a.detail_versions.history, b.detail_versions.history);
    assert_eq!(after.epics, before.epics);
}

#[test]
fn summary_pc_errors_for_a_missing_or_malformed_project() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let (home, _) = home();
    let server = common::Running::start(home.path());
    let missing = server.get("/api/projects/ffffffffffffffffffffffffffffffff/summary");
    assert_eq!(missing.status, 404, "{}", missing.body);
    assert_eq!(missing.code(), "project_not_found");
    let malformed = server.get("/api/projects/not-an-id/summary");
    assert_eq!(malformed.status, 422, "{}", malformed.body);
    assert_eq!(malformed.code(), "invalid_value");
}

#[test]
fn summary_the_same_content_has_the_same_version_after_a_restart() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let (home, project) = home();
    let path = format!("/api/projects/{project}/summary");
    let first = {
        let server = common::Running::start(home.path());
        server.get(&path).body
    };
    let second = {
        let server = common::Running::start(home.path());
        server.get(&path).body
    };
    assert_eq!(first, second);
}

#[test]
fn summary_monitor_answers_the_same_contract_behind_the_session() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let (home, project) = home();
    let server = support::Running::start(home.path());
    let session = server.session();
    let path = format!("/monitor/api/projects/{project}/summary");
    let reply = server.get(&session, &path);
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.header("cache-control"), Some("no-store"));
    let summary = check_summary(&reply.body, &project);
    check_content(&summary);
    let etag = reply.header("etag").unwrap().to_string();
    assert_eq!(etag, format!("\"{}\"", summary.version));

    let cached = server.request(
        "GET",
        &path,
        &[("Cookie", &session.cookie), ("If-None-Match", &etag)],
        "",
    );
    assert_eq!(cached.status, 304, "{}", cached.body);
    assert!(cached.body.is_empty());

    let missing = server.get(
        &session,
        "/monitor/api/projects/ffffffffffffffffffffffffffffffff/summary",
    );
    assert_eq!(missing.status, 404, "{}", missing.body);
    // Without a session the entrance refuses it as it does every monitor read.
    let refused = server.request("GET", &path, &[], "");
    assert_ne!(refused.status, 200);
}

#[test]
fn summary_the_pc_and_the_monitor_give_the_same_body() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let (home, project) = home();
    let pc = {
        let server = common::Running::start(home.path());
        server.get(&format!("/api/projects/{project}/summary")).body
    };
    let server = support::Running::start(home.path());
    let session = server.session();
    let monitor = server
        .get(
            &session,
            &format!("/monitor/api/projects/{project}/summary"),
        )
        .body;
    assert_eq!(pc, monitor);
}
