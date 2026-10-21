//! The ngrok monitor connection over its whole life, over real HTTP on loopback:
//! starting, stopping, changing, restarting and failing, with a fake connector
//! standing in for the tunnel. No test reaches ngrok.
//!
//! The tests speak to the dedicated backend as the Edge would (public Host plus
//! the proof header). Google sign-in, the allow list and header removal belong
//! to the Edge and are not exercised: a pass here shows what the application
//! side admits, refuses and forgets, not that a real Edge enforces anything.

#[path = "support/mobile_monitor.rs"]
mod support;

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use agent_board::domain::Actor;
use agent_board::file_store::FileStore;
use agent_board::file_store::model::Choice;
use serde_json::{Value, json};
use support::home;

#[path = "support/ngrok_harness.rs"]
mod harness;
use harness::*;

const EMAIL: &str = "owner@example.com";
const COOKIE: &str = "agboard_ngrok_session";
const OTHER_PUBLIC: &str = "https://other-xyz.ngrok.app";

fn fixture() -> tempfile::TempDir {
    let home = home();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.project_by_name("monitor").unwrap().id;
    store
        .request_decision(
            &project,
            1,
            Actor::Ai,
            "Choose the first path",
            vec![
                Choice {
                    id: "keep".into(),
                    label: "Keep".into(),
                },
                Choice {
                    id: "reset".into(),
                    label: "Reset".into(),
                },
            ],
            chrono::Utc::now(),
        )
        .unwrap();
    home
}

fn proof_of(policy: &str) -> String {
    serde_json::from_str::<Value>(policy).unwrap()["on_http_request"][3]["actions"][0]["config"]
        ["headers"]["x-agboard-tunnel-proof"]
        .as_str()
        .unwrap()
        .to_string()
}

fn project_of(home: &Path) -> String {
    FileStore::open(&home.join("shared"))
        .project_by_name("monitor")
        .unwrap()
        .id
        .to_string()
}

fn env_opts() -> Opts {
    Opts {
        env_token: true,
        ..Opts::default()
    }
}

/// A running server whose fake tunnel is the newest one the connector opened.
struct Tunnel {
    s: Server,
    path: PathBuf,
    _guard: Option<tempfile::TempDir>,
    backend: SocketAddr,
    proof: String,
    public: String,
}

/// A session at one tunnel: the cookie header and the CSRF token.
struct Session {
    cookie: String,
    csrf: String,
}

impl Tunnel {
    fn up() -> Self {
        let home = fixture();
        let s = Server::start(home.path(), env_opts());
        assert_eq!(s.put(true, &[EMAIL], 0).status, 200);
        let mut t = Self::new(s, home.path().to_path_buf(), Some(home));
        t.start();
        t
    }

    fn new(s: Server, path: PathBuf, guard: Option<tempfile::TempDir>) -> Self {
        Self {
            s,
            path,
            _guard: guard,
            backend: "127.0.0.1:1".parse().unwrap(),
            proof: String::new(),
            public: PUBLIC.into(),
        }
    }

    /// Start the tunnel and take it up.
    fn start(&mut self) {
        assert_eq!(self.s.start_ngrok(json!({})).status, 202);
        self.s.wait_status("ready");
        self.refresh();
    }

    /// Take up the newest tunnel the connector opened.
    fn refresh(&mut self) {
        let calls = self.s.fake.calls.lock().unwrap();
        let call = calls.last().unwrap();
        self.backend = backend_addr(call);
        self.proof = proof_of(&call.policy);
        self.public = self
            .s
            .fake
            .public
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| PUBLIC.into());
    }

    fn host(&self) -> String {
        self.public.trim_start_matches("https://").to_string()
    }

    fn path(&self) -> &Path {
        &self.path
    }

    /// A request as the Edge forwards it: the public Host and the proof.
    fn call(&self, method: &str, path: &str, extra: &[(&str, &str)], body: &str) -> Reply {
        let host = self.host();
        let mut headers = vec![
            ("Host", host.as_str()),
            ("x-agboard-tunnel-proof", &self.proof),
        ];
        headers.extend_from_slice(extra);
        request(self.backend, method, path, &headers, body)
    }

    fn session(&self) -> Session {
        let r = self.call(
            "GET",
            "/monitor/api/session",
            &[("Sec-Fetch-Site", "same-origin")],
            "",
        );
        assert_eq!(r.status, 200, "{}", r.body);
        let set = r.header("set-cookie").expect("a new session sets a cookie");
        let value = set.split(';').next().unwrap();
        assert!(value.starts_with(&format!("{COOKIE}=")));
        Session {
            cookie: value.to_string(),
            csrf: r.json()["csrfToken"].as_str().unwrap().to_string(),
        }
    }

    fn base(&self) -> String {
        format!("/monitor/api/projects/{}", project_of(self.path()))
    }

    fn read(&self, session: &Session) -> Reply {
        self.call(
            "GET",
            &format!("{}/board", self.base()),
            &[("Cookie", &session.cookie)],
            "",
        )
    }

    fn request_id(&self, session: &Session) -> String {
        let board = self.read(session);
        assert_eq!(board.status, 200, "{}", board.body);
        board.json()["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|task| task["id"] == 1)
            .unwrap()["pendingRequestId"]
            .as_str()
            .expect("the first task still waits for an answer")
            .to_string()
    }

    fn answer(&self, session: &Session, origin: &str, request_id: &str) -> Reply {
        self.call(
            "POST",
            &format!("{}/tasks/1/answer", self.base()),
            &[
                ("Cookie", &session.cookie),
                ("Origin", origin),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Csrf", &session.csrf),
                ("Content-Type", "application/json"),
            ],
            &json!({"requestId": request_id, "choiceId": "keep", "text": "ok"}).to_string(),
        )
    }

    /// Whether the first task is still waiting for an answer in the shared files.
    fn still_waiting(&self) -> bool {
        let text = all_files_text(&self.path().join("shared"));
        !text.contains("\"choiceId\": \"keep\"") && !text.contains("choice_id: keep") && {
            let session = self.session();
            self.read(&session).json()["tasks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|task| task["id"] == 1 && task["pendingRequestId"].is_string())
        }
    }

    /// Change the allow list, which replaces the tunnel, and wait for the new one.
    fn replace_tunnel(&mut self, emails: &[&str]) {
        let old = self.proof.clone();
        let revision = self.s.get()["revision"].as_u64().unwrap();
        assert_eq!(self.s.put(true, emails, revision).status, 200);
        let end = Instant::now() + Duration::from_secs(10);
        loop {
            self.refresh();
            if self.proof != old {
                break;
            }
            assert!(Instant::now() < end, "the tunnel was not replaced");
            std::thread::sleep(Duration::from_millis(20));
        }
        self.s.wait_status("ready");
    }
}

fn assert_closed(addr: SocketAddr) {
    std::thread::sleep(Duration::from_millis(100));
    assert!(
        TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_err(),
        "{addr} still accepts connections"
    );
}

/// Open the event stream by hand so that its end can be observed.
fn open_events(t: &Tunnel, cookie: &str) -> (TcpStream, String) {
    let mut stream = TcpStream::connect(t.backend).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let head = format!(
        "GET /monitor/api/events HTTP/1.1\r\nHost: {}\r\nx-agboard-tunnel-proof: {}\r\nCookie: {cookie}\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n",
        t.host(),
        t.proof
    );
    stream.write_all(head.as_bytes()).unwrap();
    let mut seen = String::new();
    let mut buf = [0u8; 1024];
    let end = Instant::now() + Duration::from_secs(5);
    while Instant::now() < end && !seen.contains("event: ready") {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => seen.push_str(&String::from_utf8_lossy(&buf[..n])),
        }
        if seen.starts_with("HTTP/1.1 4") {
            break;
        }
    }
    (stream, seen)
}

/// Whether the peer closes the stream within `wait`.
fn stream_ends(mut stream: TcpStream, wait: Duration) -> bool {
    stream
        .set_read_timeout(Some(Duration::from_millis(200)))
        .unwrap();
    let end = Instant::now() + wait;
    let mut buf = [0u8; 1024];
    while Instant::now() < end {
        match stream.read(&mut buf) {
            Ok(0) => return true,
            Ok(_) => {}
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => return true,
        }
    }
    false
}

fn no_secret_on_disk_or_in_the_pc_api(t: &Tunnel, secrets: &[&str]) {
    let disk = all_files_text(t.path());
    let api = t.s.get().to_string();
    for secret in secrets.iter().chain(&[TOKEN]) {
        assert!(!disk.contains(secret), "a secret reached the disk");
        assert!(!api.contains(secret), "a secret reached the PC API");
    }
}

// ----------------------------------------------------------------- starting

#[test]
fn the_tunnel_starts_only_when_asked_or_restored_and_every_listener_is_loopback() {
    // A plain run with a token and nothing saved never opens a tunnel.
    let home = fixture();
    {
        let s = Server::start(home.path(), env_opts());
        assert!(s.local.ip().is_loopback());
        assert_eq!(s.get()["status"], "disabled");
        assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
        // Saving the setting, even as enabled, is not a start.
        assert_eq!(s.put(true, &[EMAIL], 0).status, 200);
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
        assert_ne!(s.get()["status"], "ready");
    }
    // The saved, enabled setting is restored by the next plain run, and then
    // the dedicated backend is on loopback, apart from the PC entrance.
    let s = Server::start(home.path(), env_opts());
    s.wait_status("ready");
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 1);
    let backend = backend_addr(s.fake.calls.lock().unwrap().last().unwrap());
    assert!(backend.ip().is_loopback());
    assert_ne!(backend.port(), s.local.port());
    drop(s);

    // Saved and enabled but no token: nothing starts; the PC entrance serves.
    let s = Server::start(home.path(), Opts::default());
    assert_eq!(s.get()["status"], "needs_config");
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
    assert_eq!(request(s.local, "GET", "/", &[], "").status, 200);
    drop(s);

    // Saved and disabled, with a token: nothing starts.
    let s = Server::start(home.path(), env_opts());
    s.wait_status("ready");
    let revision = s.get()["revision"].as_u64().unwrap();
    assert_eq!(s.put(false, &[EMAIL], revision).status, 200);
    drop(s);
    let s = Server::start(home.path(), env_opts());
    assert_eq!(s.get()["status"], "disabled");
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
}

// ----------------------------------------------------------- every entrance

#[test]
fn every_kind_of_request_needs_the_entrance_and_then_a_session() {
    let t = Tunnel::up();
    let live = t.session();
    let request_id = t.request_id(&live);
    let page = t.call("GET", "/monitor/", &[], "");
    let start = page.body.find("/assets/monitor/").unwrap();
    let asset: String = page.body[start..]
        .chars()
        .take_while(|c| *c != '"' && *c != '\'')
        .collect();
    let base = t.base();
    let answer = format!("{base}/tasks/1/answer");
    let body = json!({"requestId": request_id, "choiceId": "keep", "text": "ok"}).to_string();
    let kinds: Vec<(&str, String)> = vec![
        ("GET", "/monitor/".into()),
        ("GET", asset.clone()),
        ("GET", "/logo-white.png".into()),
        ("GET", "/monitor/api/session".into()),
        ("GET", format!("{base}/board")),
        ("GET", format!("{base}/epics")),
        ("GET", "/monitor/api/events".into()),
        ("POST", answer.clone()),
    ];

    // Entrances that are not the Edge's: none of the kinds of request gets in,
    // not even with a live session cookie and its CSRF token.
    let wrong = "00".repeat(32);
    let host = t.host();
    let entrances: Vec<Vec<(&str, &str)>> = vec![
        vec![],
        vec![("Host", host.as_str())],
        vec![("x-agboard-tunnel-proof", t.proof.as_str())],
        vec![
            ("Host", "127.0.0.1"),
            ("x-agboard-tunnel-proof", t.proof.as_str()),
        ],
        vec![
            ("Host", host.as_str()),
            ("x-agboard-tunnel-proof", wrong.as_str()),
        ],
        vec![
            ("Host", host.as_str()),
            ("x-agboard-tunnel-proof", t.proof.as_str()),
            ("x-agboard-tunnel-proof", t.proof.as_str()),
        ],
        vec![
            ("Host", host.as_str()),
            ("ngrok-auth-user-email", EMAIL),
            ("ngrok-auth-user-id", "1"),
            ("X-Forwarded-Host", host.as_str()),
        ],
    ];
    for entrance in &entrances {
        for (method, path) in &kinds {
            let mut headers = entrance.clone();
            headers.extend([
                ("Cookie", live.cookie.as_str()),
                ("Origin", t.public.as_str()),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Csrf", live.csrf.as_str()),
                ("Content-Type", "application/json"),
            ]);
            let r = request(t.backend, method, path, &headers, &body);
            assert_eq!(r.status, 403, "{method} {path} {entrance:?}");
            assert!(!r.body.contains(&t.proof));
        }
    }
    assert!(t.still_waiting(), "a refused entrance wrote an answer");

    // The Edge's entrance without a session: the page and its assets are
    // public to it; everything that holds data or writes needs the session.
    for (method, path) in &kinds {
        let r = t.call(method, path, &[("Sec-Fetch-Site", "same-origin")], &body);
        let want = match path {
            p if p == "/monitor/"
                || *p == asset
                || p == "/logo-white.png"
                || p == "/monitor/api/session" =>
            {
                200
            }
            _ => 401,
        };
        assert_eq!(r.status, want, "{method} {path}");
    }
    assert!(t.still_waiting());
    // The page's header logo is a PNG, served to the Edge's entrance only.
    let logo = t.call("GET", "/logo-white.png", &[], "");
    assert_eq!(logo.header("content-type").as_deref(), Some("image/png"));
    assert_eq!(t.answer(&live, &t.public, &request_id).status, 200);
}

// ------------------------------------------------------------ stop and change

#[test]
fn stopping_ends_reads_events_and_answers_and_a_restart_starts_clean() {
    let mut t = Tunnel::up();
    let old = t.session();
    let request_id = t.request_id(&old);
    let (stream, seen) = open_events(&t, &old.cookie);
    assert!(seen.contains("event: ready"), "{seen}");
    let (old_backend, old_proof) = (t.backend, t.proof.clone());

    assert!(t.s.stop_ngrok().status < 300);
    let v = t.s.wait_status("disabled");
    assert_eq!(v["url"], Value::Null);
    assert!(
        stream_ends(stream, Duration::from_secs(5)),
        "the stream stayed open"
    );
    // Nothing is left to read from or to answer at.
    assert_closed(old_backend);
    // The PC sees no device, pairing or approval to deal with.
    let text = v.to_string().to_lowercase();
    for word in ["device", "pairing", "approv", "grant"] {
        assert!(!text.contains(word), "{word} in {text}");
    }
    // The question was left alone, and the files are whole.
    let store = FileStore::open(&t.path().join("shared"));
    assert!(store.project_by_name("monitor").is_ok());

    // A new start is a new tunnel: the old proof and the old session are dead.
    assert_eq!(t.s.start_ngrok(json!({})).status, 202);
    t.s.wait_status("ready");
    t.refresh();
    assert_ne!(t.proof, old_proof);
    let host = t.host();
    let stale_proof = [
        ("Host", host.as_str()),
        ("x-agboard-tunnel-proof", old_proof.as_str()),
        ("Cookie", old.cookie.as_str()),
    ];
    assert_eq!(
        request(t.backend, "GET", "/monitor/api/projects", &stale_proof, "").status,
        403
    );
    assert_eq!(t.read(&old).status, 401);
    assert_eq!(t.answer(&old, &t.public, &request_id).status, 401);
    assert!(t.still_waiting());
    // The new session answers, and the write lands in the shared files.
    let fresh = t.session();
    assert_eq!(t.answer(&fresh, &t.public, &request_id).status, 200);
    assert!(!t.still_waiting());
}

#[test]
fn changing_the_allow_list_or_the_public_origin_ends_the_old_session_and_stream() {
    let mut t = Tunnel::up();
    let old = t.session();
    let request_id = t.request_id(&old);
    let (stream, seen) = open_events(&t, &old.cookie);
    assert!(seen.contains("event: ready"), "{seen}");
    let (old_backend, old_host, old_origin) = (t.backend, t.host(), t.public.clone());

    // A new allow list and, with the new tunnel, a new public origin.
    *t.s.fake.public.lock().unwrap() = Some(OTHER_PUBLIC.into());
    t.replace_tunnel(&[EMAIL, "friend@example.com"]);
    assert_eq!(t.public, OTHER_PUBLIC);
    assert_eq!(t.s.get()["url"], OTHER_PUBLIC);
    assert!(
        stream_ends(stream, Duration::from_secs(5)),
        "the stream outlived its tunnel"
    );
    assert_closed(old_backend);

    // The old session does not read or answer at the new origin.
    assert_eq!(t.read(&old).status, 401);
    assert_eq!(t.answer(&old, OTHER_PUBLIC, &request_id).status, 401);
    // The old public Host does not open the new backend, whatever it carries.
    let stale_host = [
        ("Host", old_host.as_str()),
        ("x-agboard-tunnel-proof", t.proof.as_str()),
        ("Cookie", old.cookie.as_str()),
    ];
    assert_eq!(
        request(t.backend, "GET", "/monitor/api/projects", &stale_host, "").status,
        403
    );
    assert!(t.still_waiting());

    // A session of the new origin answers, and only for that origin.
    let fresh = t.session();
    assert_eq!(t.answer(&fresh, &old_origin, &request_id).status, 403);
    assert!(t.still_waiting());
    assert_eq!(t.answer(&fresh, OTHER_PUBLIC, &request_id).status, 200);
}

// ------------------------------------------------------ failure and restart

#[test]
fn a_failed_start_leaves_no_listener_or_secret_and_the_pc_and_writes_keep_working() {
    let home = fixture();
    let s = Server::start(home.path(), env_opts());
    assert_eq!(s.put(true, &[EMAIL], 0).status, 200);
    *s.fake.fail.lock().unwrap() = true;
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    let v = s.wait_status("failed");
    assert!(!v.to_string().contains(TOKEN));
    let failed_backend = backend_addr(s.fake.calls.lock().unwrap().last().unwrap());
    assert_closed(failed_backend);
    let mut t = Tunnel::new(s, home.path().to_path_buf(), Some(home));
    no_secret_on_disk_or_in_the_pc_api(&t, &[]);

    // The PC entrance still serves and still edits.
    assert_eq!(request(t.s.local, "GET", "/", &[], "").status, 200);
    let project = project_of(t.path());
    let created = t.s.write(
        "POST",
        &format!("/api/projects/{project}/tasks"),
        &json!({"title": "Made at the PC", "assignee": "human"}),
    );
    assert!(created.status < 300, "{} {}", created.status, created.body);

    // The next start works, and its session answers.
    *t.s.fake.fail.lock().unwrap() = false;
    t.start();
    let session = t.session();
    let request_id = t.request_id(&session);
    assert_eq!(t.answer(&session, &t.public, &request_id).status, 200);
}

#[test]
fn a_restart_never_revives_an_old_session_or_proof_and_keeps_no_secret() {
    let home = fixture();
    let (old, old_proof, old_backend) = {
        let s = Server::start(home.path(), env_opts());
        assert_eq!(s.put(true, &[EMAIL], 0).status, 200);
        let mut t = Tunnel::new(s, home.path().to_path_buf(), None);
        t.start();
        let session = t.session();
        assert_eq!(t.read(&session).status, 200);
        (session, t.proof.clone(), t.backend)
    };
    assert_closed(old_backend);

    // The next run restores the saved, enabled setting with a new proof.
    let s = Server::start(home.path(), env_opts());
    s.wait_status("ready");
    let mut t = Tunnel::new(s, home.path().to_path_buf(), None);
    t.refresh();
    assert_ne!(t.proof, old_proof);
    let host = t.host();
    // The old cookie means nothing to the new run, and the old proof is refused.
    assert_eq!(t.read(&old).status, 401);
    let stale_proof = [
        ("Host", host.as_str()),
        ("x-agboard-tunnel-proof", old_proof.as_str()),
    ];
    assert_eq!(
        request(t.backend, "GET", "/monitor/", &stale_proof, "").status,
        403
    );

    // A new session reads and answers, so the files were not left broken.
    let fresh = t.session();
    let request_id = t.request_id(&fresh);
    assert_eq!(t.answer(&old, &t.public, &request_id).status, 401);
    assert_eq!(t.answer(&fresh, &t.public, &request_id).status, 200);

    // Neither run left a session, CSRF value, proof or token in the files.
    let disk = all_files_text(home.path());
    let secrets = [
        old.cookie.trim_start_matches(&format!("{COOKIE}=")),
        fresh.cookie.trim_start_matches(&format!("{COOKIE}=")),
        old.csrf.as_str(),
        fresh.csrf.as_str(),
        old_proof.as_str(),
        t.proof.as_str(),
        TOKEN,
    ];
    for secret in secrets {
        assert!(!disk.contains(secret), "a secret reached the disk");
    }
}

// ------------------------------------------------------------ the boundaries

#[test]
fn the_entrance_exposes_no_desktop_editing_and_the_pc_entrance_is_unchanged() {
    let t = Tunnel::up();
    let session = t.session();
    let project = project_of(t.path());
    let tasks_before = t.read(&session).json()["tasks"].as_array().unwrap().len();

    let edits = [
        ("POST", format!("/api/projects/{project}/tasks")),
        ("PATCH", format!("/api/projects/{project}/tasks/1")),
        ("DELETE", format!("/api/projects/{project}/tasks/1")),
        ("POST", format!("/monitor/api/projects/{project}/tasks")),
        ("PATCH", format!("{}/tasks/1", t.base())),
        ("DELETE", format!("{}/tasks/1", t.base())),
        ("PUT", "/api/monitor-connections/settings/ngrok".into()),
        (
            "POST",
            "/api/monitor-connections/transports/ngrok/stop".into(),
        ),
        ("GET", "/api/monitor-connections".into()),
    ];
    for (method, path) in &edits {
        let r = t.call(
            method,
            path,
            &[
                ("Cookie", &session.cookie),
                ("Origin", &t.public),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Csrf", &session.csrf),
                ("X-Agboard-Token", "guess"),
                ("Content-Type", "application/json"),
            ],
            &json!({"title": "From the phone"}).to_string(),
        );
        assert!(
            matches!(r.status, 404 | 405),
            "{method} {path} -> {}",
            r.status
        );
    }
    assert_eq!(
        t.read(&session).json()["tasks"].as_array().unwrap().len(),
        tasks_before
    );
    assert!(t.still_waiting());

    // The PC entrance serves and edits as before, with the tunnel up.
    assert!(t.s.local.ip().is_loopback());
    assert_eq!(request(t.s.local, "GET", "/", &[], "").status, 200);
    let made = t.s.write(
        "POST",
        &format!("/api/projects/{project}/tasks"),
        &json!({"title": "Made at the PC", "assignee": "human"}),
    );
    assert!(made.status < 300, "{} {}", made.status, made.body);
    assert_eq!(
        t.read(&session).json()["tasks"].as_array().unwrap().len(),
        tasks_before + 1
    );
    // Its management API is the local entrance's alone: the public host is refused there.
    let r = request(
        t.s.local,
        "GET",
        "/api/monitor-connections",
        &[("Host", &t.host())],
        "",
    );
    assert_eq!(r.status, 403);
    assert!(!r.body.contains("allowEmails"));
}
