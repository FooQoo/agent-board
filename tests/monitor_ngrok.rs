//! The ngrok monitor entrance over real HTTP on loopback: what the dedicated
//! backend admits.
//!
//! No test reaches ngrok. A fake connector opens the "tunnel", and the tests
//! speak to the backend as the Edge would (the public Host). The Edge is opened
//! without a Traffic Policy and sets no header the app relies on: the entrance is
//! the exact public Host and the passcode of the start, which opens a session
//! and is exercised here end to end. A passing test shows the backend's
//! refusals, not that a real Edge forwards anything.

#[path = "support/mobile_monitor.rs"]
mod support;

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::atomic::Ordering;
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
const WRONG_CODE: &str = "0000";
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
    passcode: String,
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
        assert_eq!(s.put(true, 0).status, 200);
        assert_eq!(s.start_ngrok(json!({})).status, 202);
        s.wait_status("ready");
        let backend = Self::current(&s);
        let passcode = s.passcode();
        Self {
            s,
            home,
            backend,
            passcode,
        }
    }

    fn current(s: &Server) -> SocketAddr {
        let calls = s.fake.calls.lock().unwrap();
        backend_addr(calls.last().unwrap())
    }

    fn host() -> &'static str {
        PUBLIC.trim_start_matches("https://")
    }

    /// A request as the Edge forwards it: the public Host.
    fn call(&self, method: &str, path: &str, extra: &[(&str, &str)], body: &str) -> Reply {
        let mut headers = vec![("Host", Self::host())];
        headers.extend_from_slice(extra);
        request(self.backend, method, path, &headers, body)
    }

    /// Enter a passcode the way the phone's page does.
    fn unlock(&self, code: &str) -> Reply {
        self.call(
            "POST",
            "/monitor/api/unlock",
            &[
                ("Origin", PUBLIC),
                ("Sec-Fetch-Site", "same-origin"),
                ("Content-Type", "application/json"),
            ],
            &json!({"code": code}).to_string(),
        )
    }

    /// Start a session with the passcode of this start: the cookie value and the CSRF token.
    fn session(&self) -> (String, String) {
        let r = self.unlock(&self.passcode);
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
fn open_events(addr: SocketAddr, project: &str, cookie: &str) -> (TcpStream, String) {
    let mut stream = TcpStream::connect(addr).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let head = format!(
        "GET /monitor/api/events?project={project} HTTP/1.1\r\nHost: {}\r\nCookie: {cookie}\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n",
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

// ------------------------------------------------------- no Traffic Policy

#[test]
fn the_endpoint_is_opened_without_a_traffic_policy_and_nothing_checks_a_proof_header() {
    // The connector is handed the token and the loopback backend, and nothing else:
    // there is no policy and no domain to send, so a plan without Traffic Policy
    // can run it.
    let t = Tunnel::up();
    {
        let calls = t.s.fake.calls.lock().unwrap();
        let call = calls.last().unwrap();
        assert_eq!(call.token, TOKEN);
        assert!(call.backend.starts_with("http://127.0.0.1:"));
    }
    // The source has no `.traffic_policy(` call and names no proof header, so a plan
    // that rejects Traffic Policy keeps working. (A source scan is the only way to
    // see the SDK call without a network.)
    let mut stack = vec![std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "rs") {
                let text = std::fs::read_to_string(&path).unwrap();
                assert!(!text.contains(".traffic_policy("), "{}", path.display());
                assert!(!text.contains("tunnel-proof"), "{}", path.display());
            }
        }
    }
}

// ---------------------------------------------------------------- entrance

#[test]
fn only_the_exact_public_host_is_admitted() {
    let t = Tunnel::up();
    let with_port = format!("{}:443", Tunnel::host());
    let hostile: Vec<Vec<(&str, &str)>> = vec![
        // No Host of its own: the client library names the loopback address.
        vec![],
        vec![("Host", "127.0.0.1")],
        vec![("Host", "localhost")],
        vec![("Host", "evil.ngrok.app")],
        vec![("Host", with_port.as_str())],
        // Headers a client can write are not an identity, and not a Host.
        vec![
            ("ngrok-auth-user-email", EMAIL),
            ("x-forwarded-host", Tunnel::host()),
            ("Authorization", "Bearer x"),
        ],
        vec![
            ("Host", "127.0.0.1"),
            ("x-forwarded-host", Tunnel::host()),
            ("forwarded", "host=fake-abc.ngrok.app"),
            ("x-original-host", Tunnel::host()),
        ],
    ];
    for headers in &hostile {
        for path in ["/monitor/", "/monitor/api/session", "/monitor/api/projects"] {
            let r = request(t.backend, "GET", path, headers, "");
            assert_eq!(r.status, 403, "{path} {headers:?}");
            assert!(r.body.contains("not available"));
        }
        // Not even the right passcode gets a session from there.
        let unlock = request(
            t.backend,
            "POST",
            "/monitor/api/unlock",
            &[
                headers.as_slice(),
                &[
                    ("Origin", PUBLIC),
                    ("Sec-Fetch-Site", "same-origin"),
                    ("Content-Type", "application/json"),
                ],
            ]
            .concat(),
            &json!({"code": t.passcode}).to_string(),
        );
        assert_eq!(unlock.status, 403, "{headers:?}");
        assert!(unlock.header("set-cookie").is_none());
    }
    // Two Host headers, even both right, are not "the" Host. (Sent by hand: a client
    // library will not send two.)
    let mut raw = TcpStream::connect(t.backend).unwrap();
    raw.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let head = format!(
        "GET /monitor/ HTTP/1.1\r\nHost: {0}\r\nHost: {0}\r\nConnection: close\r\n\r\n",
        Tunnel::host()
    );
    raw.write_all(head.as_bytes()).unwrap();
    let mut answer = String::new();
    let _ = raw.read_to_string(&mut answer);
    assert!(answer.starts_with("HTTP/1.1 403"), "{answer}");
    // Method overrides are refused even when everything else is right.
    let r = t.call(
        "GET",
        "/monitor/",
        &[("X-HTTP-Method-Override", "DELETE")],
        "",
    );
    assert_eq!(r.status, 403);
    // The public Host admits the page; an extra header changes nothing either way.
    assert_eq!(t.call("GET", "/monitor/", &[], "").status, 200);
    assert_eq!(
        t.call("GET", "/monitor/", &[("x-agboard-tunnel-proof", "x")], "")
            .status,
        200
    );
    // The local entrance's address is no public Host.
    let local = request(
        t.backend,
        "GET",
        "/monitor/",
        &[("Host", &t.s.local.to_string())],
        "",
    );
    assert_eq!(local.status, 403);
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
    let path = format!("/monitor/api/projects/{}/summary", t.project());
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
fn a_session_starts_only_with_the_passcode_and_gets_a_scoped_cookie() {
    let t = Tunnel::up();
    // Not at the entrance: nothing is issued, with or without the right passcode.
    let direct = request(
        t.backend,
        "POST",
        "/monitor/api/unlock",
        &[
            ("Origin", PUBLIC),
            ("Sec-Fetch-Site", "same-origin"),
            ("Content-Type", "application/json"),
        ],
        &json!({"code": t.passcode}).to_string(),
    );
    assert_eq!(direct.status, 403);
    assert!(direct.header("set-cookie").is_none());
    // At the entrance but without a session, nothing is issued by merely asking.
    let ask = t.call(
        "GET",
        "/monitor/api/session",
        &[("Sec-Fetch-Site", "same-origin")],
        "",
    );
    assert_eq!(ask.status, 401);
    assert_eq!(ask.json()["error"]["code"], "session_required");
    assert!(ask.header("set-cookie").is_none());

    let r = t.unlock(&t.passcode);
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
    let value = cookie[COOKIE.len() + 1..]
        .split(';')
        .next()
        .unwrap()
        .to_string();
    assert!(!r.body.contains(&value));

    // A page that asks again with its cookie keeps the session and its token.
    let again = t.call(
        "GET",
        "/monitor/api/session",
        &[("Cookie", &cookie_header(&value))],
        "",
    );
    assert_eq!(again.status, 200);
    assert!(again.header("set-cookie").is_none());
    assert_eq!(again.json()["csrfToken"], body["csrfToken"]);

    // Asking for a session takes GET only, and not from another site.
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
    // Opening one takes POST only.
    assert_eq!(t.call("GET", "/monitor/api/unlock", &[], "").status, 405);
}

#[test]
fn unlock_wants_the_page_itself_and_a_small_json_body_and_a_wrong_code_gets_nothing() {
    let t = Tunnel::up();
    let good = json!({"code": t.passcode}).to_string();
    let page = [
        ("Origin", PUBLIC),
        ("Sec-Fetch-Site", "same-origin"),
        ("Content-Type", "application/json"),
    ];
    let without = |name: &str| -> Vec<(&str, &str)> {
        page.iter()
            .filter(|(k, _)| !k.eq_ignore_ascii_case(name))
            .cloned()
            .collect()
    };
    let mut cases: Vec<(&str, Headers, u16)> = vec![
        ("no origin", without("Origin"), 403),
        ("no fetch metadata", without("Sec-Fetch-Site"), 403),
        (
            "foreign origin",
            vec![
                ("Origin", "https://evil.example"),
                ("Sec-Fetch-Site", "same-origin"),
                ("Content-Type", "application/json"),
            ],
            403,
        ),
        (
            "http origin",
            vec![
                ("Origin", "http://fake-abc.ngrok.app"),
                ("Sec-Fetch-Site", "same-origin"),
                ("Content-Type", "application/json"),
            ],
            403,
        ),
        (
            "cross-site",
            vec![
                ("Origin", PUBLIC),
                ("Sec-Fetch-Site", "cross-site"),
                ("Content-Type", "application/json"),
            ],
            403,
        ),
        (
            "not json",
            vec![
                ("Origin", PUBLIC),
                ("Sec-Fetch-Site", "same-origin"),
                ("Content-Type", "text/plain"),
            ],
            415,
        ),
    ];
    let mut with_override = page.to_vec();
    with_override.push(("X-HTTP-Method-Override", "DELETE"));
    cases.push(("method override", with_override, 403));
    // Whatever the page forges, the identity headers of an Edge are not read.
    for (name, headers, want) in cases {
        let r = t.call("POST", "/monitor/api/unlock", &headers, &good);
        assert_eq!(r.status, want, "{name}: {}", r.body);
        assert!(r.header("set-cookie").is_none(), "{name}");
    }
    for body in [
        "not json",
        "{}",
        r#"{"code":1234}"#,
        r#"{"code":"1","x":1}"#,
    ] {
        let r = t.call("POST", "/monitor/api/unlock", &page, body);
        assert_eq!(r.status, 400, "{body}: {}", r.body);
    }
    let big = json!({"code": "1".repeat(10_000)}).to_string();
    assert_eq!(
        t.call("POST", "/monitor/api/unlock", &page, &big).status,
        413
    );
    // Header forgeries and refusals counted for nothing: the passcode still opens.
    for forged in [
        ("ngrok-auth-user-email", EMAIL),
        ("X-Forwarded-For", "127.0.0.1"),
        ("Authorization", "Bearer x"),
    ] {
        let mut headers = page.to_vec();
        headers.push(forged);
        let r = t.call("POST", "/monitor/api/unlock", &headers, &good);
        assert_eq!(r.status, 200, "{forged:?}: {}", r.body);
    }

    // A wrong code gets no cookie and no hint at all.
    let wrong = if t.passcode == WRONG_CODE {
        "0001"
    } else {
        WRONG_CODE
    };
    let r = t.unlock(wrong);
    assert_eq!(r.status, 403);
    assert!(r.header("set-cookie").is_none());
    assert_eq!(r.json()["error"]["code"], "unlock_failed");
    assert!(!r.body.contains(&t.passcode));
    // A guess that is not even four digits is answered the same way (two more of the five).
    let odd = t.unlock("12345");
    assert_eq!(odd.status, 403);
    assert_eq!(odd.body, r.body, "the answer must not vary");
    assert_eq!(t.unlock("").body, r.body);
}

#[test]
fn five_wrong_passcodes_in_a_row_stop_the_run_and_a_new_start_makes_a_new_passcode() {
    let mut t = Tunnel::up();
    let right = t.passcode.clone();
    let wrong = if right == WRONG_CODE {
        "0001"
    } else {
        WRONG_CODE
    };
    // Four wrong ones and then the right one: it opens, and the count starts again.
    for _ in 0..4 {
        assert_eq!(t.unlock(wrong).status, 403);
    }
    assert_eq!(t.unlock(&right).status, 200);
    for _ in 0..4 {
        assert_eq!(t.unlock(wrong).status, 403);
    }
    // The fifth wrong one in a row is still just wrong; every attempt after it is refused,
    // the right passcode too, and nothing is issued.
    assert_eq!(t.unlock(wrong).status, 403);
    for code in [wrong, right.as_str(), right.as_str()] {
        let r = t.unlock(code);
        assert_eq!(r.status, 429, "{code}: {}", r.body);
        assert_eq!(r.json()["error"]["code"], "unlock_locked");
        assert!(r.header("set-cookie").is_none());
        assert!(!r.body.contains(&right));
    }
    // The PC still shows the passcode and the status, but never the count.
    let status = t.s.get();
    assert_eq!(status["status"], "ready");
    let mut keys: Vec<&str> = status
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "failure",
            "keychainAvailable",
            "keychainTokenSaved",
            "passcode",
            "revision",
            "settings",
            "status",
            "tokenConfigured",
            "tokenSource",
            "url"
        ]
    );

    // Starting the connection again is a new passcode and a clean count.
    t.s.stop_ngrok();
    t.s.wait_status("disabled");
    assert_eq!(t.s.start_ngrok(json!({})).status, 202);
    t.s.wait_status("ready");
    t.backend = Tunnel::current(&t.s);
    t.passcode = t.s.passcode();
    let r = t.unlock(&t.passcode);
    assert_eq!(r.status, 200, "{}", r.body);
}

#[test]
fn the_cookie_alone_cannot_reach_the_backend() {
    let t = Tunnel::up();
    let (value, _) = t.session();
    let cookie = cookie_header(&value);
    for headers in [
        vec![("Cookie", cookie.as_str())],
        vec![("Cookie", cookie.as_str()), ("Host", "127.0.0.1")],
        vec![("Cookie", cookie.as_str()), ("Host", "evil.ngrok.app")],
        vec![
            ("Cookie", cookie.as_str()),
            ("X-Forwarded-Host", Tunnel::host()),
        ],
    ] {
        let r = request(t.backend, "GET", "/monitor/api/projects", &headers, "");
        assert_eq!(r.status, 403, "{headers:?}");
    }
    assert_eq!(
        t.call(
            "GET",
            &format!("/monitor/api/projects/{}/summary", t.project()),
            &[("Cookie", &cookie)],
            ""
        )
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
        t.call(
            "GET",
            &format!("/monitor/api/projects/{}/summary", t.project()),
            &[("Cookie", &cookie)],
            ""
        )
        .status,
        200
    );
    let old_backend = t.backend;
    let opens = t.s.fake.opens.load(Ordering::SeqCst);

    // A new start means a new tunnel, passcode and session store.
    assert_eq!(t.s.start_ngrok(json!({})).status, 202);
    let end = Instant::now() + Duration::from_secs(10);
    while t.s.fake.opens.load(Ordering::SeqCst) <= opens {
        assert!(Instant::now() < end, "the tunnel was not replaced");
        std::thread::sleep(Duration::from_millis(20));
    }
    t.s.wait_status("ready");
    let backend = Tunnel::current(&t.s);
    std::thread::sleep(Duration::from_millis(100));
    assert!(TcpStream::connect_timeout(&old_backend, Duration::from_millis(300)).is_err());
    // The old cookie is no session of the new run, though the Host is the same.
    let headers = [("Host", Tunnel::host()), ("Cookie", cookie.as_str())];
    assert_eq!(
        request(backend, "GET", "/monitor/api/projects", &headers, "").status,
        401
    );
    // The new run has its own passcode, and that one opens a session there.
    let fresh = t.s.passcode();
    let unlock = request(
        backend,
        "POST",
        "/monitor/api/unlock",
        &[
            ("Host", Tunnel::host()),
            ("Origin", PUBLIC),
            ("Sec-Fetch-Site", "same-origin"),
            ("Content-Type", "application/json"),
        ],
        &json!({"code": fresh}).to_string(),
    );
    assert_eq!(unlock.status, 200, "{}", unlock.body);
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
        format!("{base}/summary"),
        format!("{base}/tasks/1/detail"),
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
    // The whole-board reads are gone, also for a phone with a session.
    for old in [
        "/monitor/api/projects".to_string(),
        format!("{base}/board"),
        format!("{base}/epics"),
        format!("{base}/epics/EPIC-1"),
    ] {
        assert_eq!(t.call("GET", &old, &with, "").status, 404, "{old}");
    }
    let board = t.call("GET", &format!("{base}/summary"), &with, "");
    assert_eq!(board.status, 200);
    assert_eq!(board.header("cache-control").as_deref(), Some("no-store"));
    assert!(
        board.body.contains("Choose the first path") || board.body.contains("pendingRequestId")
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
        "/board/",
        "/api/projects",
        "/api/monitor-connections",
        "/monitor/other",
        "/index.html",
    ] {
        assert_eq!(t.call("GET", p, &with, "").status, 404, "{p}");
    }
    // The bare origin forwards to the monitor page (the ngrok warning page ends there).
    assert_eq!(t.call("GET", "/", &with, "").status, 308);
    // Wrong methods are 405, also with a full set of write headers.
    let w = write_headers(&cookie, &csrf);
    for (m, p) in [
        ("POST", "/monitor/api/projects".to_string()),
        ("DELETE", format!("{base}/summary")),
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
    assert!(!page.body.contains("Choose the first path"));
    // Its assets are served to the entrance without a session, and not otherwise.
    let start = page.body.find("/monitor/assets/monitor/").unwrap();
    let asset: String = page.body[start..]
        .chars()
        .take_while(|c| *c != '"' && *c != '\'')
        .collect();
    assert_eq!(t.call("GET", &asset, &[], "").status, 200);
    assert_eq!(request(t.backend, "GET", &asset, &[], "").status, 403);
    assert_eq!(
        t.call("GET", "/monitor/assets/monitor/not-there.js", &[], "")
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
        .call(
            "GET",
            &format!("{base}/summary"),
            &[("Cookie", &cookie)],
            "",
        )
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
        .call(
            "GET",
            &format!("{base}/summary"),
            &[("Cookie", &cookie)],
            "",
        )
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
        .call(
            "GET",
            &format!("{base}/summary"),
            &[("Cookie", &cookie)],
            "",
        )
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
fn a_preference_save_needs_the_session_origin_fetch_metadata_csrf_and_json() {
    let t = Tunnel::up();
    let path = "/monitor/api/preferences";
    // Without a session the route is closed, also for reading.
    assert_eq!(t.call("GET", path, &[], "").status, 401);
    let (value, csrf) = t.session();
    let cookie = cookie_header(&value);
    let read = |t: &Tunnel| -> Value {
        let r = t.call("GET", path, &[("Cookie", &cookie)], "");
        assert_eq!(r.status, 200, "{}", r.body);
        r.json()
    };
    let fresh = read(&t);
    assert_eq!(fresh["locale"], "en", "{fresh}");
    assert_eq!(fresh["revision"], 0, "{fresh}");

    let body = json!({"locale": "ja"}).to_string();
    let good = write_headers(&cookie, &csrf);
    let without = |name: &str| -> Vec<(&str, &str)> {
        good.iter()
            .filter(|(k, _)| !k.eq_ignore_ascii_case(name))
            .cloned()
            .collect()
    };
    let (_other, other_csrf) = t.session();
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
        let r = t.call("PUT", path, &headers, &body);
        assert_eq!(r.status, want, "{name}: {}", r.body);
        assert_eq!(read(&t), fresh, "{name} changed the saved value");
    }

    // An invalid value is refused by the store, not saved.
    let bad = t.call("PUT", path, &good, &json!({"locale": "fr"}).to_string());
    assert_eq!(bad.status, 422, "{}", bad.body);
    assert_eq!(
        bad.json()["error"]["code"],
        "invalid_preferences",
        "{}",
        bad.body
    );
    assert_eq!(read(&t), fresh);

    // The good request saves, and the next read shows it.
    let r = t.call("PUT", path, &good, &body);
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(read(&t)["locale"], "ja");
}

#[test]
fn disconnect_ends_the_session_and_leaves_no_logout_path() {
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
        t.call(
            "GET",
            &format!("{base}/summary"),
            &[("Cookie", &cookie)],
            ""
        )
        .status,
        200
    );
    let r = t.call("POST", "/monitor/api/disconnect", &w, "{}");
    assert_eq!(r.status, 200, "{}", r.body);
    // The answer is only that the session ended: there is no Edge sign-in to leave.
    assert_eq!(r.json(), json!({"disconnected": true}));
    assert!(!r.body.contains("logout"));
    let cleared = r.header("set-cookie").unwrap();
    assert!(cleared.contains("Max-Age=0") && cleared.contains("Path=/monitor/"));
    for p in [format!("{base}/summary"), "/monitor/api/events".to_string()] {
        assert_eq!(t.call("GET", &p, &[("Cookie", &cookie)], "").status, 401);
    }
    assert_eq!(
        t.call("POST", &format!("{base}/tasks/1/answer"), &w, "{}")
            .status,
        401
    );
    // The passcode of the run still works: the same phone can open a new session.
    assert_eq!(t.unlock(&t.passcode).status, 200);
}

// --------------------------------------------------------------------- SSE

#[test]
fn the_event_stream_needs_a_session_and_ends_when_the_run_stops() {
    let t = Tunnel::up();
    let (_, denied) = open_events(t.backend, &t.project(), "");
    assert!(denied.starts_with("HTTP/1.1 401"), "{denied}");
    assert!(!denied.contains("event: ready"));
    let (value, _) = t.session();
    let (stream, seen) = open_events(t.backend, &t.project(), &cookie_header(&value));
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
    let (stream, seen) = open_events(t.backend, &t.project(), &cookie);
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
    let (_, again) = open_events(t.backend, &t.project(), &cookie);
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
fn no_session_value_reaches_the_disk_or_the_pc_api() {
    let t = Tunnel::up();
    let (value, csrf) = t.session();
    let _ = t.call(
        "GET",
        "/monitor/api/projects",
        &[("Cookie", &cookie_header(&value))],
        "",
    );
    let disk = all_files_text(t.home.path());
    for secret in [value.as_str(), csrf.as_str(), TOKEN] {
        assert!(!disk.contains(secret));
        assert!(!t.s.get().to_string().contains(secret));
    }
}

#[test]
fn the_passcode_is_four_digits_for_the_pc_only_while_ready_and_is_never_written_down() {
    let t = Tunnel::up();
    let status = t.s.get();
    let code = status["passcode"].as_str().unwrap().to_string();
    assert_eq!(code.len(), 4);
    assert!(code.bytes().all(|b| b.is_ascii_digit()), "{code}");
    assert_eq!(code, t.passcode);

    // What the phone is served never names a passcode, and the run's own
    // answers (the session, an error, a refusal) never repeat it.
    let (value, csrf) = t.session();
    let cookie = cookie_header(&value);
    let page = t.call("GET", "/monitor/", &[], "");
    let session = t.call("GET", "/monitor/api/session", &[("Cookie", &cookie)], "");
    let wrong = t.unlock(if code == WRONG_CODE {
        "0001"
    } else {
        WRONG_CODE
    });
    for reply in [&page, &session, &wrong] {
        assert!(
            !reply.body.to_lowercase().contains("passcode\":\"")
                && !reply.body.contains(&format!("\"{code}\""))
        );
    }
    assert!(!page.body.contains(&csrf));

    // On disk there is no passcode, in any file, under any name. A 4-digit value
    // is compared as a JSON string, since a plain search would match ids and times.
    let disk = all_files_text(t.home.path()).to_lowercase();
    assert!(!disk.contains("passcode"));
    for file in ["serve.json", ".internal/monitor-connection.json"] {
        let text = std::fs::read_to_string(t.home.path().join(file)).unwrap();
        let value: Value = serde_json::from_str(&text).unwrap();
        for (key, field) in value.as_object().unwrap() {
            assert_ne!(field.as_str(), Some(code.as_str()), "{file} {key}");
        }
    }

    // Stopped, the PC is not told the passcode any more.
    let stopped = t.s.stop_ngrok().json();
    assert!(stopped.get("passcode").is_none(), "{stopped}");
    assert!(t.s.get().get("passcode").is_none());
}
