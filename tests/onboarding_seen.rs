//! The first-run guide's one stored fact: whether this data area has seen it. The
//! file, the legacy mapping and the cleanup of an older release's sample cards, and
//! the two routes on a running `agboard serve`.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};

use agent_board::domain::{Actor, Assignee, NewTask, ProjectId};
use agent_board::file_store::FileStore;
use agent_board::file_store::onboarding_state::{GuideOutcome, GuideStatus};
use chrono::{TimeZone, Utc};
use serde_json::{Value, json};

const RUN_ID: &str = "0123456789abcdef0123456789abcdef";

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 10, 1, 0, 0).unwrap()
}

fn state_path(home: &Path) -> std::path::PathBuf {
    home.join("shared/.internal/onboarding.json")
}

fn read_state(home: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(state_path(home)).unwrap()).unwrap()
}

fn write_legacy(home: &Path, status: &str, run: Value) {
    let path = state_path(home);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let file = json!({
        "formatVersion": 1,
        "revision": 7,
        "status": status,
        "owner": null,
        "run": run,
        "appliedCommands": ["a", "b"],
    });
    fs::write(path, file.to_string()).unwrap();
}

fn new_task(store: &FileStore, project: &ProjectId, title: &str) -> i64 {
    store
        .create_task(
            project,
            NewTask {
                title: title.into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            now(),
        )
        .unwrap()
        .id
}

/// A task file the way an older release wrote a sample card: with `onboardingSample`.
fn mark_as_old_sample(home: &Path, project: &ProjectId, id: i64, ordinal: u8) {
    let path = home
        .join("shared/projects")
        .join(project.to_string())
        .join("tasks")
        .join(id.to_string())
        .join("task.json");
    let mut value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    value["onboardingSample"] = json!({"runId": RUN_ID, "ordinal": ordinal});
    fs::write(path, serde_json::to_string_pretty(&value).unwrap()).unwrap();
}

fn archived(store: &FileStore, project: &ProjectId, id: i64) -> bool {
    store.task(project, id).unwrap().archived_at.is_some()
}

#[test]
fn a_data_area_without_the_file_is_unseen_and_reading_writes_nothing() {
    let home = tempfile::tempdir().unwrap();
    let store = FileStore::open(&home.path().join("shared"));
    let file = store.guide(now()).unwrap();
    assert_eq!((file.format_version, file.status), (2, GuideStatus::Unseen));
    assert!(!state_path(home.path()).exists());
}

#[test]
fn the_outcome_is_saved_as_version_two_and_a_later_outcome_replaces_it() {
    let home = tempfile::tempdir().unwrap();
    let store = FileStore::open(&home.path().join("shared"));
    store.guide_seen(GuideOutcome::Skipped, now()).unwrap();
    assert_eq!(
        read_state(home.path()),
        json!({"formatVersion": 2, "status": "skipped"})
    );
    assert_eq!(store.guide(now()).unwrap().status, GuideStatus::Skipped);
    store.guide_seen(GuideOutcome::Completed, now()).unwrap();
    assert_eq!(
        read_state(home.path()),
        json!({"formatVersion": 2, "status": "completed"})
    );
}

#[test]
fn a_version_one_file_maps_completed_and_skipped_and_everything_else_to_unseen() {
    for (old, expected) in [
        ("completed", "completed"),
        ("skipped", "skipped"),
        ("unseen", "unseen"),
        ("offered", "unseen"),
        ("active", "unseen"),
        ("closing", "unseen"),
        ("interrupted", "unseen"),
    ] {
        let home = tempfile::tempdir().unwrap();
        write_legacy(home.path(), old, Value::Null);
        let store = FileStore::open(&home.path().join("shared"));
        let file = store.guide(now()).unwrap();
        assert_eq!(
            serde_json::to_value(file.status).unwrap(),
            json!(expected),
            "{old}"
        );
        assert_eq!(
            read_state(home.path()),
            json!({"formatVersion": 2, "status": expected}),
            "{old}"
        );
    }
}

#[test]
fn an_unknown_format_version_is_refused() {
    let home = tempfile::tempdir().unwrap();
    let path = state_path(home.path());
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, r#"{"formatVersion":9,"status":"completed"}"#).unwrap();
    let store = FileStore::open(&home.path().join("shared"));
    assert!(store.guide(now()).is_err());
    assert!(store.guide_seen(GuideOutcome::Skipped, now()).is_err());
}

#[test]
fn the_sample_cards_of_an_open_version_one_run_are_archived_once() {
    let home = tempfile::tempdir().unwrap();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.create_project("Alpha", now()).unwrap().id;
    let first = new_task(&store, &project, "Sample one");
    let second = new_task(&store, &project, "Sample two");
    let other = new_task(&store, &project, "A real task");
    mark_as_old_sample(home.path(), &project, first, 1);
    mark_as_old_sample(home.path(), &project, second, 2);
    write_legacy(
        home.path(),
        "active",
        json!({
            "runId": RUN_ID,
            "attemptId": "x",
            "projectId": project.to_string(),
            "locale": "en",
            "createdAt": "2026-10-10T01:00:00Z",
            "sampleIds": [first, second],
            "phase": "samples",
            "questionRequestId": null,
            "closingReason": null,
        }),
    );

    // The first read upgrades the file and archives only the run's cards.
    let file = store.guide(now()).unwrap();
    assert_eq!(file.status, GuideStatus::Unseen);
    assert!(archived(&store, &project, first));
    assert!(archived(&store, &project, second));
    assert!(!archived(&store, &project, other));
    assert_eq!(
        read_state(home.path()),
        json!({"formatVersion": 2, "status": "unseen"})
    );

    // The file is version 2 now, so a restored card is not archived again.
    store.restore_task(&project, first, now()).unwrap();
    store.guide_upgrade(now()).unwrap();
    assert!(!archived(&store, &project, first));
}

#[test]
fn the_server_start_archives_old_samples_before_any_read() {
    let home = tempfile::tempdir().unwrap();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.create_project("Alpha", now()).unwrap().id;
    let card = new_task(&store, &project, "Sample one");
    mark_as_old_sample(home.path(), &project, card, 1);
    write_legacy(
        home.path(),
        "interrupted",
        json!({
            "runId": RUN_ID,
            "attemptId": "x",
            "projectId": project.to_string(),
            "locale": "ja",
            "createdAt": "2026-10-10T01:00:00Z",
            "sampleIds": [card],
            "phase": "first-running",
            "questionRequestId": null,
            "closingReason": null,
        }),
    );
    store.guide_upgrade(now()).unwrap();
    assert!(archived(&store, &project, card));
    assert_eq!(read_state(home.path())["formatVersion"], 2);
}

#[test]
fn a_version_one_run_whose_project_is_gone_still_upgrades() {
    let home = tempfile::tempdir().unwrap();
    write_legacy(
        home.path(),
        "offered",
        json!({
            "runId": RUN_ID,
            "attemptId": "x",
            "projectId": "ffffffffffffffffffffffffffffffff",
            "locale": "en",
            "createdAt": "2026-10-10T01:00:00Z",
            "sampleIds": [1, 2],
            "phase": "samples",
            "questionRequestId": null,
            "closingReason": null,
        }),
    );
    let store = FileStore::open(&home.path().join("shared"));
    assert_eq!(store.guide(now()).unwrap().status, GuideStatus::Unseen);
    assert_eq!(read_state(home.path())["formatVersion"], 2);
}

#[test]
fn a_task_file_with_the_old_marker_still_reads_and_keeps_it() {
    let home = tempfile::tempdir().unwrap();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.create_project("Alpha", now()).unwrap().id;
    let id = new_task(&store, &project, "Old sample");
    mark_as_old_sample(home.path(), &project, id, 1);
    assert_eq!(store.task(&project, id).unwrap().id, id);
    store.archive_task(&project, id, now()).unwrap();
    let path = home
        .path()
        .join("shared/projects")
        .join(project.to_string())
        .join("tasks")
        .join(id.to_string())
        .join("task.json");
    let value: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(value["onboardingSample"]["ordinal"], 1);
}

struct Server {
    child: Child,
    port: u16,
}

impl Server {
    fn start(home: &Path) -> Server {
        let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
            .env("AGBOARD_AUTOSTART", "0")
            .env("AGBOARD_OPEN_BROWSER", "0")
            .env("AGBOARD_WATCH", "poll")
            .env("AGBOARD_HOME", home)
            .env("TZ", "UTC")
            .args(["serve", "--port", "0"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let rest = &line[line.find("127.0.0.1:").expect(&line) + "127.0.0.1:".len()..];
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        Server {
            child,
            port: digits.parse().unwrap(),
        }
    }

    fn agent(&self) -> ureq::Agent {
        ureq::Agent::config_builder()
            .http_status_as_error(false)
            .build()
            .into()
    }

    fn token(&self) -> String {
        let mut response = self
            .agent()
            .get(&format!("http://127.0.0.1:{}/", self.port))
            .call()
            .unwrap();
        let page = response.body_mut().read_to_string().unwrap();
        let marker = "name=\"agboard-token\" content=\"";
        let start = page.find(marker).unwrap() + marker.len();
        page[start..start + 64].to_string()
    }

    fn get(&self, path: &str) -> (u16, Value) {
        let mut response = self
            .agent()
            .get(&format!("http://127.0.0.1:{}{path}", self.port))
            .call()
            .unwrap();
        let status = response.status().as_u16();
        let text = response.body_mut().read_to_string().unwrap_or_default();
        (status, serde_json::from_str(&text).unwrap_or(Value::Null))
    }

    fn post(&self, path: &str, body: &str, token: Option<&str>) -> (u16, Value) {
        let mut request = self
            .agent()
            .post(&format!("http://127.0.0.1:{}{path}", self.port))
            .header("Origin", &format!("http://127.0.0.1:{}", self.port))
            .header("Sec-Fetch-Site", "same-origin")
            .header("Content-Type", "application/json");
        if let Some(token) = token {
            request = request.header("X-Agboard-Token", token);
        }
        let mut response = request.send(body.to_string()).unwrap();
        let status = response.status().as_u16();
        let text = response.body_mut().read_to_string().unwrap_or_default();
        (status, serde_json::from_str(&text).unwrap_or(Value::Null))
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn the_routes_report_and_record_the_outcome() {
    let home = tempfile::tempdir().unwrap();
    let server = Server::start(home.path());
    let token = server.token();

    let (status, body) = server.get("/api/onboarding");
    assert_eq!(status, 200);
    assert_eq!(body, json!({"formatVersion": 2, "status": "unseen"}));

    let (status, body) = server.post(
        "/api/onboarding/seen",
        r#"{"outcome":"skipped"}"#,
        Some(&token),
    );
    assert_eq!(status, 200);
    assert_eq!(body, json!({"formatVersion": 2, "status": "skipped"}));
    assert_eq!(server.get("/api/onboarding").1["status"], "skipped");

    let (_, body) = server.post(
        "/api/onboarding/seen",
        r#"{"outcome":"completed"}"#,
        Some(&token),
    );
    assert_eq!(body, json!({"formatVersion": 2, "status": "completed"}));
    assert_eq!(
        read_state(home.path()),
        json!({"formatVersion": 2, "status": "completed"})
    );
}

#[test]
fn the_seen_route_refuses_a_bad_body_and_a_missing_token() {
    let home = tempfile::tempdir().unwrap();
    let server = Server::start(home.path());
    let token = server.token();
    for body in [
        r#"{"outcome":"unseen"}"#,
        r#"{"outcome":"offered"}"#,
        r#"{}"#,
        r#"{"outcome":"completed","extra":1}"#,
    ] {
        let (status, reply) = server.post("/api/onboarding/seen", body, Some(&token));
        assert_eq!(status, 422, "{body}");
        assert_eq!(reply["error"]["code"], "invalid_value", "{body}");
    }
    let (status, reply) = server.post("/api/onboarding/seen", "{nope", Some(&token));
    assert_eq!(status, 400);
    assert_eq!(reply["error"]["code"], "invalid_json");
    let (status, _) = server.post("/api/onboarding/seen", r#"{"outcome":"completed"}"#, None);
    assert_eq!(status, 403);
    assert_eq!(server.get("/api/onboarding").1["status"], "unseen");
}

#[test]
fn the_other_guide_routes_are_gone() {
    let home = tempfile::tempdir().unwrap();
    let server = Server::start(home.path());
    let token = server.token();
    for path in [
        "/api/onboarding/claim",
        "/api/onboarding/replay",
        "/api/onboarding/heartbeat",
        "/api/onboarding/skip",
        "/api/onboarding/recover",
        "/api/projects/0123456789abcdef0123456789abcdef/onboarding/start",
    ] {
        let (status, _) = server.post(path, "{}", Some(&token));
        assert_eq!(status, 404, "{path}");
    }
}
