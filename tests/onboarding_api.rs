//! The first-run guide's HTTP routes on a running `agboard serve`: the state, the
//! lease, the start and its retry, the scripted steps, the answer gate, finish,
//! and the write guard, with the same headers a page of this server sends.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};

use agent_board::file_store::FileStore;
use serde_json::{Value, json};

struct Server {
    child: Child,
    port: u16,
}

impl Server {
    fn start(home: &Path) -> Server {
        let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
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
        // The first line names the address the server bound, for example http://127.0.0.1:52341.
        let rest = &line[line.find("127.0.0.1:").expect(&line) + "127.0.0.1:".len()..];
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        let port = digits.parse().unwrap();
        Server { child, port }
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

    /// A POST the way a page of this server sends it: the origin, the fetch site,
    /// and the session token.
    fn post(&self, path: &str, body: Value) -> (u16, Value) {
        self.post_with(path, body, Some(&self.token()))
    }

    fn post_with(&self, path: &str, body: Value, token: Option<&str>) -> (u16, Value) {
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

fn cli(home: &Path, args: &[&str]) {
    let output = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn project_id(home: &Path) -> String {
    let folder = home.join("folder-guide");
    fs::create_dir_all(&folder).unwrap();
    cli(
        home,
        &[
            "project",
            "create",
            "guide",
            "--folder",
            &folder.display().to_string(),
        ],
    );
    FileStore::open(&home.join("shared"))
        .project_by_name("guide")
        .unwrap()
        .id
        .to_string()
}

#[test]
fn the_state_is_readable_without_a_token_and_starts_unseen() {
    let home = tempfile::tempdir().unwrap();
    let _project = project_id(home.path());
    let server = Server::start(home.path());
    let (status, state) = server.get("/api/onboarding");
    assert_eq!(status, 200);
    assert_eq!(state["status"], "unseen");
    assert_eq!(state["revision"], 0);
}

#[test]
fn a_write_without_the_session_token_is_refused() {
    let home = tempfile::tempdir().unwrap();
    let _project = project_id(home.path());
    let server = Server::start(home.path());
    let (status, _) = server.post_with(
        "/api/onboarding/claim",
        json!({"clientId": "tab-a", "expectedRevision": 0}),
        None,
    );
    assert_eq!(status, 403);
    assert_eq!(server.get("/api/onboarding").1["status"], "unseen");
}

#[test]
fn a_full_run_over_http_archives_its_samples_and_completes_the_guide() {
    let home = tempfile::tempdir().unwrap();
    let project = project_id(home.path());
    let server = Server::start(home.path());

    let (status, claimed) = server.post(
        "/api/onboarding/claim",
        json!({"clientId": "tab-a", "expectedRevision": 0}),
    );
    assert_eq!(status, 200, "{claimed}");
    assert_eq!(claimed["status"], "offered");
    let revision = claimed["revision"].as_u64().unwrap();

    let start_path = format!("/api/projects/{project}/onboarding/start");
    let (status, started) = server.post(
        &start_path,
        json!({"clientId": "tab-a", "attemptId": "attempt-1", "expectedRevision": revision, "locale": "en"}),
    );
    assert_eq!(status, 200, "{started}");
    let run_id = started["run"]["runId"].as_str().unwrap().to_string();
    let samples: Vec<i64> = started["run"]["sampleIds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_i64().unwrap())
        .collect();
    assert_eq!(samples.len(), 2);

    // A repeated start with the same attempt names the same cards.
    let (status, again) = server.post(
        &start_path,
        json!({"clientId": "tab-a", "attemptId": "attempt-1", "expectedRevision": started["revision"], "locale": "en"}),
    );
    assert_eq!(status, 200);
    assert_eq!(again["run"]["sampleIds"], started["run"]["sampleIds"]);

    let advance = |revision: u64, command: &str, transition: &str| {
        server.post(
            &format!("/api/projects/{project}/onboarding/{run_id}/advance"),
            json!({"clientId": "tab-a", "expectedRevision": revision, "commandId": command, "transition": transition}),
        )
    };

    // A step out of order is refused with the invalid-input status.
    let (status, error) = advance(again["revision"].as_u64().unwrap(), "x1", "first-done");
    assert_eq!(status, 422, "{error}");
    assert_eq!(error["error"]["code"], "onboarding_invalid");

    let mut current = again;
    for (command, transition) in [
        ("c1", "first-running"),
        ("c2", "first-done"),
        ("c3", "ask-question"),
    ] {
        let (status, next) = advance(current["revision"].as_u64().unwrap(), command, transition);
        assert_eq!(status, 200, "{next}");
        current = next;
    }
    let (_, board) = server.get(&format!("/api/projects/{project}/board"));
    let second = samples[1];
    let request = board["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["id"] == second)
        .and_then(|task| task["pendingRequestId"].as_str())
        .unwrap()
        .to_string();

    // Resuming before the answer is saved is refused.
    let (status, _) = advance(
        current["revision"].as_u64().unwrap(),
        "early",
        "resume-second",
    );
    assert_eq!(status, 422);

    let (status, _) = server.post(
        &format!("/api/projects/{project}/tasks/{second}/answer"),
        json!({"requestId": request, "choiceId": "brief"}),
    );
    assert_eq!(status, 200);

    for (command, transition) in [
        ("c4", "resume-second"),
        ("c5", "second-done"),
        ("c6", "complete"),
    ] {
        let (status, next) = advance(current["revision"].as_u64().unwrap(), command, transition);
        assert_eq!(status, 200, "{next}");
        current = next;
    }
    let (status, finished) = server.post(
        &format!("/api/projects/{project}/onboarding/{run_id}/finish"),
        json!({"clientId": "tab-a", "expectedRevision": current["revision"], "commandId": "fin"}),
    );
    assert_eq!(status, 200, "{finished}");
    assert_eq!(finished["status"], "completed");

    // The samples are archived, not deleted, and the board no longer lists them.
    let (_, board) = server.get(&format!("/api/projects/{project}/board"));
    let listed: Vec<i64> = board["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|task| task["id"].as_i64().unwrap())
        .collect();
    assert!(samples.iter().all(|id| !listed.contains(id)));
}

#[test]
fn a_second_tab_is_refused_while_the_first_holds_the_guide() {
    let home = tempfile::tempdir().unwrap();
    let _project = project_id(home.path());
    let server = Server::start(home.path());
    let (status, _) = server.post(
        "/api/onboarding/claim",
        json!({"clientId": "tab-a", "expectedRevision": 0}),
    );
    assert_eq!(status, 200);
    let (status, error) = server.post(
        "/api/onboarding/claim",
        json!({"clientId": "tab-b", "expectedRevision": 1}),
    );
    assert_eq!(status, 409);
    assert_eq!(error["error"]["code"], "onboarding_conflict");
}

#[test]
fn an_unknown_field_is_refused() {
    let home = tempfile::tempdir().unwrap();
    let _project = project_id(home.path());
    let server = Server::start(home.path());
    let (status, _) = server.post(
        "/api/onboarding/claim",
        json!({"clientId": "tab-a", "expectedRevision": 0, "extra": true}),
    );
    assert!(status >= 400, "an unknown field is refused, got {status}");
}

#[test]
fn a_run_whose_tab_was_gone_when_the_server_stopped_is_taken_back_at_the_next_start() {
    let home = tempfile::tempdir().unwrap();
    let project = project_id(home.path());
    let state_path = home
        .path()
        .join("shared")
        .join(".internal")
        .join("onboarding.json");
    {
        let server = Server::start(home.path());
        let (_, claimed) = server.post(
            "/api/onboarding/claim",
            json!({"clientId": "tab-a", "expectedRevision": 0}),
        );
        let (status, _) = server.post(
            &format!("/api/projects/{project}/onboarding/start"),
            json!({"clientId": "tab-a", "attemptId": "attempt-1", "expectedRevision": claimed["revision"], "locale": "en"}),
        );
        assert_eq!(status, 200);
    }
    // The tab's lease ran out while the server was down.
    let mut file: Value = serde_json::from_str(&fs::read_to_string(&state_path).unwrap()).unwrap();
    file["owner"]["leaseUntil"] = json!("2020-01-01T00:00:00Z");
    fs::write(&state_path, file.to_string()).unwrap();

    let server = Server::start(home.path());
    let (_, state) = server.get("/api/onboarding");
    assert_eq!(state["status"], "interrupted", "{state}");
    assert!(state["owner"].is_null());
    let (_, board) = server.get(&format!("/api/projects/{project}/board"));
    assert_eq!(
        board["tasks"].as_array().unwrap().len(),
        0,
        "the samples are archived"
    );
}
