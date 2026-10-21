//! The ngrok monitor entrance over real HTTP on loopback: the Edge policy that
//! is handed to the connector, and what the dedicated backend admits.
//!
//! No test reaches ngrok. A fake connector opens the "tunnel", and the tests
//! speak to the backend as the Edge would (public Host plus the proof header).
//! Google sign-in, the allow list and header removal are enforced by the Edge
//! and are not exercised here: a passing test shows the policy that would ask
//! for them and the backend's refusals, not that a real Edge enforces them.

#[path = "support/mobile_monitor.rs"]
mod support;

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use agent_board::domain::{Actor, Assignee, NewTask};
use agent_board::file_store::FileStore;
use agent_board::file_store::model::Choice;
use serde_json::{Value, json};
use support::home;

#[path = "support/ngrok_harness.rs"]
mod harness;
use harness::*;

type Headers<'a> = Vec<(&'a str, &'a str)>;

const EMAIL: &str = "owner@example.com";
const COOKIE: &str = "agboard_ngrok_session";

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
    store
        .create_task(
            &project,
            NewTask {
                title: "Second".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            chrono::Utc::now(),
        )
        .unwrap();
    home
}

/// A running server with the fake tunnel up.
struct Tunnel {
    s: Server,
    home: tempfile::TempDir,
    backend: SocketAddr,
    proof: String,
}

fn proof_of(policy: &str) -> String {
    serde_json::from_str::<Value>(policy).unwrap()["on_http_request"][3]["actions"][0]["config"]
        ["headers"]["x-agboard-tunnel-proof"]
        .as_str()
        .unwrap()
        .to_string()
}

impl Tunnel {
    fn up() -> Self {
        let home = fixture();
        let s = Server::start(
            home.path(),
            Opts {
                env_token: true,
                ..Opts::default()
            },
        );
        assert_eq!(s.put(true, &[EMAIL], 0).status, 200);
        assert_eq!(s.start_ngrok(json!({})).status, 202);
        s.wait_status("ready");
        let (backend, proof) = Self::current(&s);
        Self {
            s,
            home,
            backend,
            proof,
        }
    }

    fn current(s: &Server) -> (SocketAddr, String) {
        let calls = s.fake.calls.lock().unwrap();
        let call = calls.last().unwrap();
        (backend_addr(call), proof_of(&call.policy))
    }

    fn host() -> &'static str {
        PUBLIC.trim_start_matches("https://")
    }

    /// A request as the Edge forwards it: public Host and the proof.
    fn call(&self, method: &str, path: &str, extra: &[(&str, &str)], body: &str) -> Reply {
        let mut headers = vec![
            ("Host", Self::host()),
            ("x-agboard-tunnel-proof", &self.proof),
        ];
        headers.extend_from_slice(extra);
        request(self.backend, method, path, &headers, body)
    }

    /// Start a session: the cookie value and the CSRF token.
    fn session(&self) -> (String, String) {
        let r = self.call(
            "GET",
            "/monitor/api/session",
            &[("Sec-Fetch-Site", "same-origin")],
            "",
        );
        assert_eq!(r.status, 200, "{}", r.body);
        let cookie = r.header("set-cookie").expect("a new session sets a cookie");
        let value = cookie
            .strip_prefix(&format!("{COOKIE}="))
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        (value, r.json()["csrfToken"].as_str().unwrap().to_string())
    }

    fn project(&self) -> String {
        FileStore::open(&self.home.path().join("shared"))
            .project_by_name("monitor")
            .unwrap()
            .id
            .to_string()
    }
}

fn cookie_header(value: &str) -> String {
    format!("{COOKIE}={value}")
}

fn write_headers<'a>(cookie: &'a str, csrf: &'a str) -> Vec<(&'a str, &'a str)> {
    vec![
        ("Cookie", cookie),
        ("Origin", PUBLIC),
        ("Sec-Fetch-Site", "same-origin"),
        ("X-Agboard-Csrf", csrf),
        ("Content-Type", "application/json"),
    ]
}

/// Open the event stream by hand so that its end can be observed.
fn open_events(addr: SocketAddr, proof: &str, cookie: &str) -> (TcpStream, String) {
    let mut stream = TcpStream::connect(addr).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let head = format!(
        "GET /monitor/api/events HTTP/1.1\r\nHost: {}\r\nx-agboard-tunnel-proof: {proof}\r\nCookie: {cookie}\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n",
        Tunnel::host()
    );
    stream.write_all(head.as_bytes()).unwrap();
    let mut seen = String::new();
    let mut buf = [0u8; 1024];
    let end = Instant::now() + Duration::from_secs(5);
    while Instant::now() < end && !seen.contains("event: ready") && !seen.contains("\r\n\r\n{") {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => seen.push_str(&String::from_utf8_lossy(&buf[..n])),
            Err(_) => break,
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

// ------------------------------------------------------------------ policy

#[test]
fn the_edge_policy_asks_for_google_then_the_allow_list_then_one_proof() {
    let t = Tunnel::up();
    let policy: Value = {
        let calls = t.s.fake.calls.lock().unwrap();
        serde_json::from_str(&calls.last().unwrap().policy).unwrap()
    };
    let phases = policy["on_http_request"].as_array().unwrap();
    assert_eq!(phases.len(), 4);
    assert_eq!(phases[0]["actions"][0]["type"], "oauth");
    assert_eq!(phases[0]["actions"][0]["config"]["provider"], "google");
    assert!(
        phases[0].get("expressions").is_none(),
        "no path is excluded"
    );
    let expression = phases[1]["expressions"][0].as_str().unwrap();
    assert_eq!(
        expression,
        format!("!(actions.ngrok.oauth.identity.email in [\"{EMAIL}\"])")
    );
    assert_eq!(phases[1]["actions"][0]["type"], "deny");
    assert_eq!(phases[2]["actions"][0]["type"], "remove-headers");
    assert_eq!(
        phases[2]["actions"][0]["config"]["headers"],
        json!(["x-agboard-tunnel-proof"])
    );
    assert_eq!(phases[3]["actions"][0]["type"], "add-headers");
    assert_eq!(t.proof.len(), 64);
}

// ---------------------------------------------------------------- entrance

#[test]
fn only_the_public_host_with_exactly_one_correct_proof_is_admitted() {
    let t = Tunnel::up();
    let p = t.proof.as_str();
    let wrong = "00".repeat(32);
    let hostile: Vec<Vec<(&str, &str)>> = vec![
        vec![],
        vec![("Host", Tunnel::host())],
        vec![("x-agboard-tunnel-proof", p)],
        vec![("Host", "127.0.0.1"), ("x-agboard-tunnel-proof", p)],
        vec![("Host", "evil.ngrok.app"), ("x-agboard-tunnel-proof", p)],
        vec![
            ("Host", Tunnel::host()),
            ("x-agboard-tunnel-proof", wrong.as_str()),
        ],
        vec![("Host", Tunnel::host()), ("x-agboard-tunnel-proof", "")],
        vec![
            ("Host", Tunnel::host()),
            ("x-agboard-tunnel-proof", p),
            ("x-agboard-tunnel-proof", p),
        ],
        vec![
            ("Host", Tunnel::host()),
            ("x-agboard-tunnel-proof", wrong.as_str()),
            ("x-agboard-tunnel-proof", p),
        ],
        // Headers a client can write are not an identity.
        vec![
            ("Host", Tunnel::host()),
            ("ngrok-auth-user-email", EMAIL),
            ("x-forwarded-host", Tunnel::host()),
            ("Authorization", "Bearer x"),
        ],
    ];
    for headers in &hostile {
        for path in ["/monitor/", "/monitor/api/session", "/monitor/api/projects"] {
            let r = request(t.backend, "GET", path, headers, "");
            assert_eq!(r.status, 403, "{path} {headers:?}");
            assert!(!r.body.contains(p));
        }
    }
    // Method overrides are refused even when everything else is right.
    let r = t.call(
        "GET",
        "/monitor/",
        &[("X-HTTP-Method-Override", "DELETE")],
        "",
    );
    assert_eq!(r.status, 403);
    // The right Host and proof admit the page.
    assert_eq!(t.call("GET", "/monitor/", &[], "").status, 200);
}

#[test]
fn forged_identity_headers_never_stand_in_for_a_session() {
    let t = Tunnel::up();
    let forged = [
        ("ngrok-auth-user-email", EMAIL),
        ("ngrok-auth-user-id", "1"),
        ("X-Forwarded-For", "127.0.0.1"),
        ("X-Forwarded-Host", "127.0.0.1"),
        ("X-Forwarded-Proto", "https"),
        ("Forwarded", "for=127.0.0.1;host=127.0.0.1"),
        ("X-Real-Ip", "127.0.0.1"),
        ("X-Agboard-Token", "x"),
        ("X-Agboard-Csrf", "x"),
        ("Origin", PUBLIC),
    ];
    let path = format!("/monitor/api/projects/{}/board", t.project());
    for p in [
        "/monitor/api/projects",
        path.as_str(),
        "/monitor/api/events",
    ] {
        assert_eq!(t.call("GET", p, &forged, "").status, 401, "{p}");
    }
    assert_eq!(
        t.call(
            "GET",
            "/monitor/api/projects",
            &[("Cookie", "agboard_ngrok_session=guess")],
            ""
        )
        .status,
        401
    );
}

// ----------------------------------------------------------------- session

#[test]
fn a_session_starts_only_at_the_verified_entrance_with_a_scoped_cookie() {
    let t = Tunnel::up();
    // Not at the entrance: nothing is issued.
    let direct = request(t.backend, "GET", "/monitor/api/session", &[], "");
    assert_eq!(direct.status, 403);
    assert!(direct.header("set-cookie").is_none());
    let r = t.call(
        "GET",
        "/monitor/api/session",
        &[("Sec-Fetch-Site", "same-origin")],
        "",
    );
    assert_eq!(r.status, 200);
    assert_eq!(r.header("cache-control").as_deref(), Some("no-store"));
    let cookie = r.header("set-cookie").unwrap();
    assert!(cookie.starts_with(&format!("{COOKIE}=")), "{cookie}");
    for part in [
        "; Secure",
        "; HttpOnly",
        "; SameSite=Lax",
        "; Path=/monitor/",
        "; Max-Age=43200",
    ] {
        assert!(cookie.contains(part), "{part} in {cookie}");
    }
    let body = r.json();
    assert_eq!(body["csrfToken"].as_str().unwrap().len(), 64);
    assert_eq!(body["expiresInSeconds"], 12 * 60 * 60);
    assert!(
        !r.body
            .contains(&cookie[COOKIE.len() + 1..COOKIE.len() + 65])
    );

    // A page that asks again with its cookie keeps the session and its token.
    let value = cookie[COOKIE.len() + 1..]
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let again = t.call(
        "GET",
        "/monitor/api/session",
        &[("Cookie", &cookie_header(&value))],
        "",
    );
    assert_eq!(again.status, 200);
    assert!(again.header("set-cookie").is_none());
    assert_eq!(again.json()["csrfToken"], body["csrfToken"]);

    // Only GET, and not from another site.
    assert_eq!(
        t.call("POST", "/monitor/api/session", &[], "{}").status,
        405
    );
    assert_eq!(t.call("HEAD", "/monitor/api/session", &[], "").status, 405);
    assert_eq!(
        t.call(
            "GET",
            "/monitor/api/session",
            &[("Sec-Fetch-Site", "cross-site")],
            ""
        )
        .status,
        403
    );
}

#[test]
fn the_cookie_alone_cannot_reach_the_backend() {
    let t = Tunnel::up();
    let (value, _) = t.session();
    let cookie = cookie_header(&value);
    for headers in [
        vec![("Cookie", cookie.as_str())],
        vec![("Cookie", cookie.as_str()), ("Host", Tunnel::host())],
        vec![("Cookie", cookie.as_str()), ("Host", "127.0.0.1")],
        vec![
            ("Cookie", cookie.as_str()),
            ("x-agboard-tunnel-proof", t.proof.as_str()),
        ],
    ] {
        let r = request(t.backend, "GET", "/monitor/api/projects", &headers, "");
        assert_eq!(r.status, 403, "{headers:?}");
    }
    assert_eq!(
        t.call("GET", "/monitor/api/projects", &[("Cookie", &cookie)], "")
            .status,
        200
    );
}

#[test]
fn a_session_dies_with_the_run_that_issued_it() {
    let t = Tunnel::up();
    let (value, _) = t.session();
    let cookie = cookie_header(&value);
    assert_eq!(
        t.call("GET", "/monitor/api/projects", &[("Cookie", &cookie)], "")
            .status,
        200
    );
    let old_backend = t.backend;
    let old_proof = t.proof.clone();

    // A new allow list means a new tunnel, proof and session store.
    let revision = t.s.get()["revision"].as_u64().unwrap();
    assert_eq!(
        t.s.put(true, &[EMAIL, "friend@example.com"], revision)
            .status,
        200
    );
    let end = Instant::now() + Duration::from_secs(10);
    let (backend, proof) = loop {
        let (b, p) = Tunnel::current(&t.s);
        if p != old_proof {
            break (b, p);
        }
        assert!(Instant::now() < end, "the tunnel was not replaced");
        std::thread::sleep(Duration::from_millis(20));
    };
    t.s.wait_status("ready");
    std::thread::sleep(Duration::from_millis(100));
    assert!(TcpStream::connect_timeout(&old_backend, Duration::from_millis(300)).is_err());
    let headers = [
        ("Host", Tunnel::host()),
        ("x-agboard-tunnel-proof", proof.as_str()),
        ("Cookie", cookie.as_str()),
    ];
    assert_eq!(
        request(backend, "GET", "/monitor/api/projects", &headers, "").status,
        401
    );
    // The old proof does not open the new backend either.
    let stale = [
        ("Host", Tunnel::host()),
        ("x-agboard-tunnel-proof", old_proof.as_str()),
        ("Cookie", cookie.as_str()),
    ];
    assert_eq!(
        request(backend, "GET", "/monitor/api/projects", &stale, "").status,
        403
    );
}

// ------------------------------------------------------------- the monitor

#[test]
fn every_monitor_route_needs_a_session_and_unknown_routes_are_not_found() {
    let t = Tunnel::up();
    let project = t.project();
    let base = format!("/monitor/api/projects/{project}");
    let routes = [
        "/monitor/api/projects".to_string(),
        format!("{base}/board"),
        format!("{base}/epics"),
        format!("{base}/epics/EPIC-1"),
        format!("{base}/tasks/1/attachments/none"),
        "/monitor/api/events".to_string(),
        "/monitor/api/nothing-here".to_string(),
    ];
    for r in &routes {
        assert_eq!(t.call("GET", r, &[], "").status, 401, "{r}");
    }
    assert_eq!(
        t.call("POST", &format!("{base}/tasks/1/answer"), &[], "{}")
            .status,
        401
    );

    let (value, csrf) = t.session();
    let cookie = cookie_header(&value);
    let with = [("Cookie", cookie.as_str())];
    assert_eq!(
        t.call("GET", "/monitor/api/projects", &with, "").status,
        200
    );
    let board = t.call("GET", &format!("{base}/board"), &with, "");
    assert_eq!(board.status, 200);
    assert_eq!(board.header("cache-control").as_deref(), Some("no-store"));
    assert!(
        board.body.contains("Choose the first path") || board.body.contains("pendingRequestId")
    );
    assert_eq!(
        t.call("GET", &format!("{base}/epics"), &with, "").status,
        200
    );
    // An attachment that is not the task's is not found, not served.
    assert_eq!(
        t.call(
            "GET",
            &format!("{base}/tasks/1/attachments/none"),
            &with,
            ""
        )
        .status,
        404
    );
    // Unknown routes are 404; there is no catch-all page.
    assert_eq!(
        t.call("GET", "/monitor/api/nothing-here", &with, "").status,
        404
    );
    for p in [
        "/",
        "/board/",
        "/api/projects",
        "/api/monitor-connections",
        "/monitor/other",
        "/index.html",
    ] {
        assert_eq!(t.call("GET", p, &with, "").status, 404, "{p}");
    }
    // Wrong methods are 405, also with a full set of write headers.
    let w = write_headers(&cookie, &csrf);
    for (m, p) in [
        ("POST", "/monitor/api/projects".to_string()),
        ("DELETE", format!("{base}/board")),
        ("PUT", format!("{base}/tasks/1/answer")),
        ("PATCH", "/monitor/api/events".to_string()),
        ("POST", format!("{base}/tasks/1/move")),
        ("POST", "/monitor/".to_string()),
    ] {
        assert_eq!(t.call(m, &p, &w, "{}").status, 405, "{m} {p}");
    }
}

#[test]
fn the_page_and_its_assets_hold_no_secret_and_need_the_entrance() {
    let t = Tunnel::up();
    let page = t.call("GET", "/monitor/", &[], "");
    assert_eq!(page.status, 200);
    assert_eq!(page.header("cache-control").as_deref(), Some("no-store"));
    let csp = page.header("content-security-policy").unwrap();
    assert!(csp.contains("frame-ancestors 'none'") && csp.contains("default-src 'none'"));
    assert_eq!(
        page.header("referrer-policy").as_deref(),
        Some("no-referrer")
    );
    assert!(page.body.contains("agboard-monitor-token\" content=\"\""));
    assert!(!page.body.contains(&t.proof));
    assert!(!page.body.contains("Choose the first path"));
    // Its assets are served to the entrance without a session, and not otherwise.
    let start = page.body.find("/assets/monitor/").unwrap();
    let asset: String = page.body[start..]
        .chars()
        .take_while(|c| *c != '"' && *c != '\'')
        .collect();
    assert_eq!(t.call("GET", &asset, &[], "").status, 200);
    assert_eq!(request(t.backend, "GET", &asset, &[], "").status, 403);
    assert_eq!(
        t.call("GET", "/assets/monitor/not-there.js", &[], "")
            .status,
        404
    );
    assert_eq!(t.call("GET", "/assets/app.js", &[], "").status, 404);
    // No shell that falls back to the page.
    assert_eq!(t.call("GET", "/monitor/anything", &[], "").status, 404);
}

// ------------------------------------------------------------------ answer

#[test]
fn an_answer_needs_the_session_origin_fetch_metadata_csrf_and_json() {
    let t = Tunnel::up();
    let base = format!("/monitor/api/projects/{}", t.project());
    let (value, csrf) = t.session();
    let cookie = cookie_header(&value);
    let board: Value = t
        .call("GET", &format!("{base}/board"), &[("Cookie", &cookie)], "")
        .json();
    let request_id = board["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["id"] == 1)
        .unwrap()["pendingRequestId"]
        .as_str()
        .unwrap()
        .to_string();
    let path = format!("{base}/tasks/1/answer");
    let body = json!({"requestId": request_id, "choiceId": "keep", "text": "ok"}).to_string();
    let good = write_headers(&cookie, &csrf);
    let without = |name: &str| -> Vec<(&str, &str)> {
        good.iter()
            .filter(|(k, _)| !k.eq_ignore_ascii_case(name))
            .cloned()
            .collect()
    };
    let (other, other_csrf) = t.session();
    let other_cookie = cookie_header(&other);
    let cases: Vec<(&str, Headers, u16)> = vec![
        ("no cookie", without("Cookie"), 401),
        ("no csrf", without("X-Agboard-Csrf"), 403),
        ("no origin", without("Origin"), 403),
        ("no fetch metadata", without("Sec-Fetch-Site"), 403),
        (
            "not json",
            {
                let mut h = without("Content-Type");
                h.push(("Content-Type", "text/plain"));
                h
            },
            415,
        ),
        (
            "wrong csrf",
            {
                let mut h = without("X-Agboard-Csrf");
                h.push(("X-Agboard-Csrf", "0".repeat(64).leak()));
                h
            },
            403,
        ),
        (
            "another session's csrf",
            {
                let mut h = without("X-Agboard-Csrf");
                h.push(("X-Agboard-Csrf", other_csrf.as_str()));
                h
            },
            403,
        ),
        (
            "foreign origin",
            {
                let mut h = without("Origin");
                h.push(("Origin", "https://evil.example"));
                h
            },
            403,
        ),
        (
            "http origin",
            {
                let mut h = without("Origin");
                h.push(("Origin", "http://fake-abc.ngrok.app"));
                h
            },
            403,
        ),
        (
            "cross-site",
            {
                let mut h = without("Sec-Fetch-Site");
                h.push(("Sec-Fetch-Site", "cross-site"));
                h
            },
            403,
        ),
        (
            "method override",
            {
                let mut h = good.clone();
                h.push(("X-HTTP-Method-Override", "DELETE"));
                h
            },
            403,
        ),
    ];
    for (name, headers, want) in cases {
        let r = t.call("POST", &path, &headers, &body);
        assert_eq!(r.status, want, "{name}: {}", r.body);
    }
    let _ = other_cookie;
    // Nothing was written by the refusals.
    let after: Value = t
        .call("GET", &format!("{base}/board"), &[("Cookie", &cookie)], "")
        .json();
    assert_eq!(
        after["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == 1)
            .unwrap()["pendingRequestId"],
        request_id.as_str()
    );

    // A client-written token and forwarding headers change nothing: the entrance
    // replaces or removes them.
    let mut ok = good.clone();
    ok.push(("X-Agboard-Token", "client-chosen"));
    ok.push(("X-Forwarded-Host", "evil.example"));
    let r = t.call("POST", &path, &ok, &body);
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.json()["changed"], true);
    let done: Value = t
        .call("GET", &format!("{base}/board"), &[("Cookie", &cookie)], "")
        .json();
    let task = done["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == 1)
        .unwrap()
        .clone();
    assert!(task["pendingRequestId"].is_null(), "{task}");
    // The saved answer is in the shared files, through the usual path.
    let text = all_files_text(&t.home.path().join("shared"));
    assert!(text.contains("ok"));
    // The same question cannot be answered twice.
    assert_ne!(t.call("POST", &path, &good, &body).status, 200);
}

#[test]
fn disconnect_ends_the_session_and_points_at_the_edge_logout() {
    let t = Tunnel::up();
    let (value, csrf) = t.session();
    let cookie = cookie_header(&value);
    let base = format!("/monitor/api/projects/{}", t.project());
    let w = write_headers(&cookie, &csrf);
    assert_eq!(t.call("GET", "/monitor/api/disconnect", &w, "").status, 405);
    assert_eq!(
        t.call(
            "POST",
            "/monitor/api/disconnect",
            &[("Cookie", &cookie)],
            "{}"
        )
        .status,
        403
    );
    assert_eq!(
        t.call("GET", &format!("{base}/board"), &[("Cookie", &cookie)], "")
            .status,
        200
    );
    let r = t.call("POST", "/monitor/api/disconnect", &w, "{}");
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.json()["logoutPath"], "/ngrok/logout");
    let cleared = r.header("set-cookie").unwrap();
    assert!(cleared.contains("Max-Age=0") && cleared.contains("Path=/monitor/"));
    for p in [format!("{base}/board"), "/monitor/api/events".to_string()] {
        assert_eq!(t.call("GET", &p, &[("Cookie", &cookie)], "").status, 401);
    }
    assert_eq!(
        t.call("POST", &format!("{base}/tasks/1/answer"), &w, "{}")
            .status,
        401
    );
}

// --------------------------------------------------------------------- SSE

#[test]
fn the_event_stream_needs_a_session_and_ends_when_the_run_stops() {
    let t = Tunnel::up();
    let (_, denied) = open_events(t.backend, &t.proof, "");
    assert!(denied.starts_with("HTTP/1.1 401"), "{denied}");
    assert!(!denied.contains("event: ready"));
    let (value, _) = t.session();
    let (stream, seen) = open_events(t.backend, &t.proof, &cookie_header(&value));
    assert!(seen.starts_with("HTTP/1.1 200"), "{seen}");
    assert!(seen.contains("event: ready"), "{seen}");
    // No token travels in the URL.
    assert!(!seen.contains(&value));
    t.s.stop_ngrok();
    assert!(
        stream_ends(stream, Duration::from_secs(5)),
        "the stream stayed open"
    );
    std::thread::sleep(Duration::from_millis(100));
    assert!(TcpStream::connect_timeout(&t.backend, Duration::from_millis(300)).is_err());
}

#[test]
fn the_event_stream_ends_when_its_session_is_disconnected() {
    let t = Tunnel::up();
    let (value, csrf) = t.session();
    let cookie = cookie_header(&value);
    let (stream, seen) = open_events(t.backend, &t.proof, &cookie);
    assert!(seen.contains("event: ready"), "{seen}");
    assert_eq!(
        t.call(
            "POST",
            "/monitor/api/disconnect",
            &write_headers(&cookie, &csrf),
            "{}"
        )
        .status,
        200
    );
    // The session is gone for new streams at once; an open one stops at its next event.
    let (_, again) = open_events(t.backend, &t.proof, &cookie);
    assert!(again.starts_with("HTTP/1.1 401"), "{again}");
    let store = FileStore::open(&t.home.path().join("shared"));
    let project = store.project_by_name("monitor").unwrap().id;
    store
        .create_task(
            &project,
            NewTask {
                title: "Wakes the stream".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            chrono::Utc::now(),
        )
        .unwrap();
    assert!(
        stream_ends(stream, Duration::from_secs(10)),
        "the stream outlived its session"
    );
}

// ----------------------------------------------------------------- secrets

#[test]
fn no_session_value_or_proof_reaches_the_disk_or_the_pc_api() {
    let t = Tunnel::up();
    let (value, csrf) = t.session();
    let _ = t.call(
        "GET",
        "/monitor/api/projects",
        &[("Cookie", &cookie_header(&value))],
        "",
    );
    let disk = all_files_text(t.home.path());
    for secret in [value.as_str(), csrf.as_str(), t.proof.as_str(), TOKEN] {
        assert!(!disk.contains(secret));
        assert!(!t.s.get().to_string().contains(secret));
    }
}
