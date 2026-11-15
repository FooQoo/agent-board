//! The board app through the ngrok entrance: the same page, routes and event stream as the local
//! entrance, opened by the passcode's session and, for writes, the session's CSRF token. No board
//! token is ever sent through the entrance.
//!
//! No test reaches ngrok. A fake connector opens the "tunnel", and the tests speak to the backend as
//! the Edge would (the public Host).

#[path = "support/mobile_monitor.rs"]
mod support;

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use serde_json::{Value, json};
use support::{ORIGIN, Reply, Running, Session, home, token};

fn json_of(reply: &Reply) -> Value {
    serde_json::from_str(&reply.body).unwrap_or_else(|_| panic!("not JSON: {}", reply.body))
}

/// A change that meets every condition of the entrance, through the board's own routes.
fn change(server: &Running, session: &Session, method: &str, path: &str, body: &Value) -> Reply {
    server.write(session, method, path, &body.to_string())
}

/// The first answer lines of an event stream, read as a browser's `EventSource` would.
fn open_events(server: &Running, cookie: Option<&str>) -> (u16, String, String) {
    let mut stream = TcpStream::connect(server.backend).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut request = format!(
        "GET /api/events HTTP/1.1\r\nHost: {}\r\nAccept: text/event-stream\r\n",
        server.host()
    );
    if let Some(cookie) = cookie {
        request.push_str(&format!("Cookie: {cookie}\r\n"));
    }
    request.push_str("Connection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).unwrap();
    let mut seen = Vec::new();
    let mut chunk = [0u8; 1024];
    // The head is enough: a stream's first event follows it.
    while !seen.windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => seen.extend_from_slice(&chunk[..n]),
        }
    }
    let text = String::from_utf8_lossy(&seen).to_string();
    let status = text
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let head = text.split("\r\n\r\n").next().unwrap_or("").to_lowercase();
    (status, head, text)
}

/// The request a local browser makes: the local Host, and for writes the Origin and token.
fn local(
    server: &Running,
    method: &str,
    path: &str,
    headers: &[(&str, String)],
    body: &str,
) -> Reply {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(5)))
        .build()
        .into();
    let mut req = ureq::http::Request::builder()
        .method(method)
        .uri(format!("http://{}{path}", server.local))
        .header("Host", server.local.to_string());
    for (name, value) in headers {
        req = req.header(*name, value);
    }
    let mut response = agent.run(req.body(body.to_owned()).unwrap()).unwrap();
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let body = response.body_mut().read_to_string().unwrap_or_default();
    Reply {
        status,
        headers,
        body,
    }
}

// -------------------------------------------------------------------- AC-1

#[test]
fn the_board_works_through_the_entrance_with_a_session_and_the_csrf_token() {
    let home = home();
    let server = Running::start(home.path());
    let session = server.session();
    let base = server.base(home.path());

    // Reads: the board's own routes.
    for path in [
        "/api/projects".to_string(),
        format!("{base}/summary"),
        format!("{base}/tasks/1/detail"),
        format!("{base}/archive"),
        format!("{base}/epics"),
        format!("{base}/qa"),
        format!("{base}/docs/tree"),
        "/api/preferences".to_string(),
        "/api/onboarding".to_string(),
    ] {
        let reply = server.get(&session, &path);
        assert_eq!(reply.status, 200, "GET {path}: {}", reply.body);
        assert_eq!(reply.header("cache-control"), Some("no-store"), "{path}");
    }

    // The event stream starts with the session.
    let (status, head, _) = open_events(&server, Some(&session.cookie));
    assert_eq!(status, 200, "{head}");
    assert!(head.contains("text/event-stream"), "{head}");

    // Writes: create, edit, move, draft, delete, an epic, and the saved preferences.
    let created = change(
        &server,
        &session,
        "POST",
        &format!("{base}/tasks"),
        &json!({"title": "From the phone", "assignee": "human", "isDraft": true}),
    );
    assert!(created.status < 300, "{} {}", created.status, created.body);
    let id = json_of(&created)["task"]["id"].as_i64().unwrap();
    let edited = change(
        &server,
        &session,
        "PATCH",
        &format!("{base}/tasks/{id}"),
        &json!({"title": "From the phone, edited"}),
    );
    assert_eq!(edited.status, 200, "{}", edited.body);
    let moved = change(
        &server,
        &session,
        "POST",
        &format!("{base}/tasks/{id}/move"),
        &json!({"taskStatus": "doing"}),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    let epic = change(
        &server,
        &session,
        "POST",
        &format!("{base}/epics"),
        &json!({"id": "PHONE-1", "name": "Phone epic"}),
    );
    assert!(epic.status < 300, "{} {}", epic.status, epic.body);
    let preferences = change(
        &server,
        &session,
        "PUT",
        "/api/preferences",
        &json!({"locale": "ja"}),
    );
    assert_eq!(preferences.status, 200, "{}", preferences.body);
    let multipart = server.request(
        "PATCH",
        &format!("{base}/tasks/{id}/multipart"),
        &[
            ("Cookie", &session.cookie),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Csrf", &session.csrf),
            ("Content-Type", "multipart/form-data; boundary=x"),
        ],
        "--x\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{}\r\n--x--\r\n",
    );
    // It reached the board's handler (a body it does not accept is its own 4xx, not the entrance's).
    assert!(
        multipart.status != 401 && multipart.status != 403 && multipart.status != 404,
        "{} {}",
        multipart.status,
        multipart.body
    );
    let archived = server.write(
        &session,
        "POST",
        &format!("{base}/tasks/{id}/archive"),
        "{}",
    );
    assert_eq!(archived.status, 200, "{}", archived.body);
    let deleted = server.write(&session, "DELETE", &format!("{base}/tasks/{id}"), "");
    assert_eq!(deleted.status, 204, "{}", deleted.body);

    // What the writes did is what a read shows.
    let summary = json_of(&server.get(&session, &format!("{base}/summary")));
    assert!(
        !summary["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|task| task["id"] == id)
    );
}

#[test]
fn a_write_needs_the_session_the_origin_the_fetch_metadata_and_the_csrf_token() {
    let home = home();
    let server = Running::start(home.path());
    let session = server.session();
    let path = format!("{}/tasks", server.base(home.path()));
    let body = json!({"title": "Refused", "assignee": "human"}).to_string();
    let good = |extra: &[(&str, &str)]| {
        let mut headers = vec![
            ("Cookie", session.cookie.as_str()),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Csrf", session.csrf.as_str()),
            ("Content-Type", "application/json"),
        ];
        headers.retain(|(name, _)| !extra.iter().any(|(n, _)| n == name));
        headers.extend_from_slice(extra);
        server.request("POST", &path, &headers, &body)
    };
    // Each condition removed or spoiled on its own.
    assert_eq!(good(&[("X-Agboard-Csrf", "wrong")]).status, 403);
    assert_eq!(good(&[("X-Agboard-Csrf", "")]).status, 403);
    assert_eq!(good(&[("Origin", "https://evil.ngrok.app")]).status, 403);
    assert_eq!(good(&[("Sec-Fetch-Site", "cross-site")]).status, 403);
    assert_eq!(
        good(&[("Cookie", "agboard_ngrok_session=nope")]).status,
        401
    );
    // The local page's token header is not a credential here.
    let guessed = server.request(
        "POST",
        &path,
        &[
            ("Cookie", &session.cookie),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", "0000"),
            ("Content-Type", "application/json"),
        ],
        &body,
    );
    assert_eq!(guessed.status, 403);
    // Nothing was written by any of them, and the right set does write.
    let summary =
        || json_of(&server.get(&session, &format!("{}/summary", server.base(home.path()))));
    assert_eq!(summary()["tasks"].as_array().unwrap().len(), 1);
    assert!(good(&[]).status < 300);
    assert_eq!(summary()["tasks"].as_array().unwrap().len(), 2);
}

#[test]
fn what_acts_on_the_pc_itself_is_not_served_through_the_entrance() {
    let home = home();
    let server = Running::start(home.path());
    let session = server.session();
    let base = server.base(home.path());
    for (method, path) in [
        ("GET", "/api/monitor-connections".to_string()),
        ("PUT", "/api/monitor-connections/settings/ngrok".to_string()),
        (
            "POST",
            "/api/monitor-connections/transports/ngrok/stop".to_string(),
        ),
        ("DELETE", "/api/monitor-connections/token".to_string()),
        ("POST", "/api/notify".to_string()),
        ("POST", format!("{base}/docs/open")),
    ] {
        let reply = if method == "GET" {
            server.get(&session, &path)
        } else {
            server.write(&session, method, &path, "{}")
        };
        assert_eq!(reply.status, 404, "{method} {path}: {}", reply.body);
    }
}

// -------------------------------------------------------------------- AC-2

#[test]
fn without_a_session_every_api_and_the_event_stream_are_401() {
    let home = home();
    let server = Running::start(home.path());
    let base = server.base(home.path());
    for (method, path) in [
        ("GET", "/api/projects".to_string()),
        ("GET", format!("{base}/summary")),
        ("GET", format!("{base}/tasks/1/detail")),
        ("GET", format!("{base}/docs/tree")),
        ("GET", format!("{base}/docs/file?path=README.md")),
        ("GET", "/api/onboarding".to_string()),
        ("GET", "/api/preferences".to_string()),
        ("GET", "/api/health".to_string()),
        ("GET", "/api/events".to_string()),
        ("GET", "/api/remote/session".to_string()),
        ("POST", format!("{base}/tasks")),
        ("DELETE", format!("{base}/tasks/1")),
        ("PUT", "/api/preferences".to_string()),
        ("POST", "/api/onboarding/skip".to_string()),
        ("GET", "/api/monitor-connections".to_string()),
        ("GET", "/api/nothing-here".to_string()),
    ] {
        let reply = server.request(
            method,
            &path,
            &[
                ("Origin", ORIGIN),
                ("Sec-Fetch-Site", "same-origin"),
                ("Content-Type", "application/json"),
            ],
            "{}",
        );
        assert_eq!(reply.status, 401, "{method} {path}: {}", reply.body);
        assert!(reply.header("set-cookie").is_none(), "{method} {path}");
        assert!(reply.body.contains("session_required"), "{path}");
    }
    let (status, _, _) = open_events(&server, None);
    assert_eq!(status, 401);
    // A cookie from nowhere and one the connection never issued are no session either.
    for cookie in ["agboard_ngrok_session=0123456789", "other=1"] {
        let reply = server.request("GET", "/api/projects", &[("Cookie", cookie)], "");
        assert_eq!(reply.status, 401, "{cookie}");
    }
}

#[test]
fn the_cookie_is_issued_only_when_the_passcode_passes() {
    let home = home();
    let server = Running::start(home.path());
    let wrong = if server.passcode == "0000" {
        "1111"
    } else {
        "0000"
    };

    // Asking for a session starts none; a wrong code issues nothing, and does not say how close it was.
    let ask = server.request("GET", "/api/remote/session", &[], "");
    assert_eq!(ask.status, 401);
    assert!(ask.header("set-cookie").is_none());
    for _ in 0..4 {
        let reply = server.unlock(wrong);
        assert_eq!(reply.status, 403, "{}", reply.body);
        assert!(reply.body.contains("unlock_failed"));
        assert!(reply.header("set-cookie").is_none());
    }
    // A request that is not the passcode screen's is refused without a guess being counted.
    let no_origin = server.request(
        "POST",
        "/api/remote/unlock",
        &[("Content-Type", "application/json")],
        &format!(r#"{{"code":"{wrong}"}}"#),
    );
    assert_eq!(no_origin.status, 403);
    assert!(no_origin.header("set-cookie").is_none());

    // The right code opens a session: a cookie for the whole entrance, and the CSRF token.
    let granted = server.unlock(&server.passcode);
    assert_eq!(granted.status, 200, "{}", granted.body);
    let cookie = granted.header("set-cookie").expect("a cookie");
    for part in [
        "agboard_ngrok_session=",
        "; Secure",
        "; HttpOnly",
        "; SameSite=Lax",
        "; Path=/;",
        "; Max-Age=43200",
    ] {
        assert!(cookie.contains(part), "{part} in {cookie}");
    }
    assert_eq!(json_of(&granted)["csrfToken"].as_str().unwrap().len(), 64);
    // It then shows the session without starting another.
    let session = server.request(
        "GET",
        "/api/remote/session",
        &[("Cookie", cookie.split(';').next().unwrap())],
        "",
    );
    assert_eq!(session.status, 200);
    assert!(session.header("set-cookie").is_none());
}

#[test]
fn five_wrong_passcodes_lock_the_entrance_and_even_the_right_one_issues_nothing() {
    let home = home();
    let server = Running::start(home.path());
    let wrong = if server.passcode == "0000" {
        "1111"
    } else {
        "0000"
    };
    for _ in 0..5 {
        assert_eq!(server.unlock(wrong).status, 403);
    }
    for code in [wrong, server.passcode.as_str()] {
        let reply = server.unlock(code);
        assert_eq!(reply.status, 429, "{}", reply.body);
        assert!(reply.body.contains("unlock_locked"));
        assert!(reply.header("set-cookie").is_none());
    }
    // The old route counts against the same passcode.
    assert_eq!(server.unlock(&server.passcode).status, 429);
    assert_eq!(server.request("GET", "/api/projects", &[], "").status, 401);
}

// -------------------------------------------------------------------- AC-3

#[test]
fn the_page_and_its_static_files_carry_no_token_and_need_no_session() {
    let home = home();
    let server = Running::start(home.path());
    // The token the local entrance embeds in its own page.
    let local_page = local(&server, "GET", "/", &[], "");
    assert_eq!(local_page.status, 200);
    let board_token = token(&local_page.body);
    assert_eq!(board_token.len(), 64);

    let page = server.request("GET", "/", &[], "");
    assert_eq!(page.status, 200, "{}", page.body);
    assert_eq!(page.header("cache-control"), Some("no-store"));
    assert!(page.body.contains("name=\"agboard-token\" content=\"\""));
    assert!(!page.body.contains(&board_token));
    assert!(!page.body.contains("{{AGBOARD"));
    let csp = page.header("content-security-policy").unwrap();
    assert!(csp.contains("frame-ancestors 'none'") && csp.contains("default-src 'none'"));
    assert_eq!(page.header("referrer-policy"), Some("no-referrer"));
    assert_eq!(page.header("x-content-type-options"), Some("nosniff"));

    // Every script and stylesheet the page names, and the other static files.
    let mut files: Vec<String> = Vec::new();
    for attr in ["src=\"", "href=\""] {
        for part in page.body.split(attr).skip(1) {
            let url = part.split('"').next().unwrap();
            if url.starts_with('/') {
                files.push(url.to_string());
            }
        }
    }
    files.extend(["/logo.png".into(), "/logo-white.png".into()]);
    files.extend(["/docs-sandbox".into()]);
    assert!(files.iter().any(|f| f.starts_with("/assets/")), "{files:?}");
    let sandbox = server.request("GET", "/docs-sandbox", &[], "");
    assert_eq!(sandbox.status, 200);
    for part in sandbox.body.split("src=\"").skip(1) {
        files.push(part.split('"').next().unwrap().to_string());
    }
    for file in &files {
        let reply = server.request("GET", file, &[], "");
        assert_eq!(reply.status, 200, "{file}");
        assert!(!reply.body.contains(&board_token), "the token is in {file}");
        assert!(reply.header("set-cookie").is_none(), "{file}");
    }
    // Their chunks, which the scripts import by name, hold none either.
    for file in files.iter().filter(|f| f.starts_with("/assets/")) {
        let script = server.request("GET", file, &[], "").body;
        for part in script.split("\"./").skip(1).take(40) {
            let name = part.split('"').next().unwrap();
            if name.ends_with(".js") {
                let chunk = server.request("GET", &format!("/assets/{name}"), &[], "");
                if chunk.status == 200 {
                    assert!(!chunk.body.contains(&board_token), "the token is in {name}");
                }
            }
        }
    }
    // A session does not change the page: it still has no token.
    let session = server.session();
    let again = server.get(&session, "/");
    assert!(!again.body.contains(&board_token));
    assert!(again.body.contains("name=\"agboard-token\" content=\"\""));
}

// -------------------------------------------------------------------- AC-4

#[test]
fn the_local_entrance_keeps_its_token_page_and_checks_with_the_tunnel_up() {
    let home = home();
    let server = Running::start(home.path());
    let base = server.base(home.path());
    let page = local(&server, "GET", "/", &[], "");
    assert_eq!(page.status, 200);
    let board_token = token(&page.body);

    // Reads need no token; the remote session routes do not exist here.
    assert_eq!(local(&server, "GET", "/api/projects", &[], "").status, 200);
    for (method, path) in [
        ("GET", "/api/remote/session"),
        ("POST", "/api/remote/unlock"),
    ] {
        let reply = local(&server, method, path, &[], "{}");
        assert!(
            matches!(reply.status, 403..=405),
            "{path}: {}",
            reply.status
        );
    }
    // The public Host is refused on the local port.
    let wrong_host = {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .build()
            .into();
        let req = ureq::http::Request::builder()
            .uri(format!("http://{}/api/projects", server.local))
            .header("Host", server.host())
            .body(String::new())
            .unwrap();
        agent.run(req).unwrap().status().as_u16()
    };
    assert_eq!(wrong_host, 403);

    // A local write needs the Origin and the token; the CSRF header and the session do not count.
    let origin = format!("http://{}", server.local);
    let body = json!({"title": "At the PC", "assignee": "human"}).to_string();
    let headers = |token: Option<&str>, csrf: bool| {
        let mut h = vec![
            ("Origin", origin.clone()),
            ("Sec-Fetch-Site", "same-origin".to_string()),
            ("Content-Type", "application/json".to_string()),
        ];
        if let Some(token) = token {
            h.push(("X-Agboard-Token", token.to_string()));
        }
        if csrf {
            h.push(("X-Agboard-Csrf", "x".repeat(64)));
        }
        h
    };
    let path = format!("{base}/tasks");
    assert_eq!(
        local(&server, "POST", &path, &headers(None, true), &body).status,
        403
    );
    let stale = local(&server, "POST", &path, &headers(Some("nope"), false), &body);
    assert!(matches!(stale.status, 403 | 409), "{}", stale.status);
    let made = local(
        &server,
        "POST",
        &path,
        &headers(Some(&board_token), false),
        &body,
    );
    assert!(made.status < 300, "{} {}", made.status, made.body);
}

// ------------------------------------------------------- the old monitor is gone

/// Every address the old mobile monitor had, whatever the method.
const OLD_MONITOR_PATHS: [&str; 12] = [
    "/monitor",
    "/monitor/",
    "/monitor/?project=0123456789abcdef0123456789abcdef",
    "/monitor/api/session",
    "/monitor/api/unlock",
    "/monitor/api/disconnect",
    "/monitor/api/events?project=0123456789abcdef0123456789abcdef",
    "/monitor/api/preferences",
    "/monitor/api/projects/0123456789abcdef0123456789abcdef/summary",
    "/monitor/api/projects/0123456789abcdef0123456789abcdef/qa/answers",
    "/monitor/assets/monitor/monitor-x.js",
    "/monitor/assets/docs-sandbox",
];

#[test]
fn the_old_monitor_addresses_are_not_found_through_the_entrance_with_or_without_a_session() {
    let home = home();
    let server = Running::start(home.path());
    let session = server.session();
    for path in OLD_MONITOR_PATHS {
        for method in ["GET", "HEAD", "POST", "PUT"] {
            // A read carries no body: the 404 comes before any body is read,
            // and an unread body on a read can break the connection.
            let body = if matches!(method, "GET" | "HEAD") {
                ""
            } else {
                "{}"
            };
            // Without a session.
            let bare = server.request(method, path, &[], body);
            assert_eq!(bare.status, 404, "{method} {path} (no session)");
            assert!(bare.header("location").is_none(), "{method} {path}");
            // With a live session and every header a change needs.
            let with = server.write(&session, method, path, body);
            assert_eq!(with.status, 404, "{method} {path} (session)");
            assert!(with.header("location").is_none(), "{method} {path}");
        }
    }
    // The bodies do not point anywhere: no page, no redirect, no token.
    let page = server.get(&session, "/monitor/");
    assert!(!page.body.contains("agboard-monitor-token"));
    assert!(!page.body.contains("<html"));
}

#[test]
fn the_old_monitor_addresses_are_not_found_on_the_local_entrance_too() {
    let home = home();
    let server = Running::start(home.path());
    for path in OLD_MONITOR_PATHS {
        let reply = local(&server, "GET", path, &[], "");
        assert_eq!(reply.status, 404, "GET {path}");
        assert!(reply.header("location").is_none(), "GET {path}");
    }
}

// ---------------------------------------------- projects through the entrance

#[test]
fn projects_are_listed_and_switched_through_the_entrance_as_on_the_pc() {
    let home = home();
    let store = agent_board::file_store::FileStore::open(&home.path().join("shared"));
    let second = store
        .create_project("second", chrono::Utc::now())
        .unwrap()
        .id;
    store
        .create_task(
            &second,
            agent_board::domain::NewTask {
                title: "Only in the second project".into(),
                description: String::new(),
                assignee: agent_board::domain::Assignee::Human,
                actor: agent_board::domain::Actor::Human,
                is_draft: false,
            },
            chrono::Utc::now(),
        )
        .unwrap();
    let first = store.project_by_name("monitor").unwrap().id;
    let server = Running::start(home.path());
    let session = server.session();

    // The list is the board's own: every project, by its ID, with its name.
    let list = server.get(&session, "/api/projects");
    assert_eq!(list.status, 200, "{}", list.body);
    let projects = json_of(&list);
    let projects = projects["projects"].as_array().expect("a projects array");
    let ids: Vec<&str> = projects.iter().filter_map(|p| p["id"].as_str()).collect();
    assert!(ids.contains(&first.as_str()), "{ids:?}");
    assert!(ids.contains(&second.as_str()), "{ids:?}");
    let names: Vec<&str> = projects.iter().filter_map(|p| p["name"].as_str()).collect();
    assert!(
        names.contains(&"monitor") && names.contains(&"second"),
        "{names:?}"
    );

    // Switching is reading the other project: each one shows its own tasks.
    let titles = |id: &str| -> Vec<String> {
        let reply = server.get(&session, &format!("/api/projects/{id}/summary"));
        assert_eq!(reply.status, 200, "{id}: {}", reply.body);
        json_of(&reply)["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| t["title"].as_str().map(str::to_owned))
            .collect()
    };
    assert_eq!(titles(first.as_str()), ["Sample"]);
    assert_eq!(titles(second.as_str()), ["Only in the second project"]);
    let unknown = server.get(
        &session,
        "/api/projects/ffffffffffffffffffffffffffffffff/summary",
    );
    assert_eq!(unknown.status, 404, "{}", unknown.body);

    // The page that names a project is the same page as the root: the board app picks the project
    // from `?project=`, as on the PC, and no token or board data is in it.
    for id in [first.as_str(), second.as_str()] {
        let page = server.request("GET", &format!("/?project={id}"), &[], "");
        assert_eq!(page.status, 200, "{id}");
        assert!(page.body.contains("name=\"agboard-token\" content=\"\""));
        assert!(!page.body.contains("Only in the second project"));
    }

    // Without a session neither the list nor a project is readable.
    assert_eq!(server.request("GET", "/api/projects", &[], "").status, 401);
    assert_eq!(
        server
            .request("GET", &format!("/api/projects/{second}/summary"), &[], "")
            .status,
        401
    );
}
