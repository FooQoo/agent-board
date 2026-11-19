//! Registered devices of the ngrok entrance over real HTTP on loopback: a right passcode
//! registers the phone, the phone comes back without the passcode after its session ended or
//! the PC restarted, and unregistering ends it. A mock connector stands in for the tunnel; no
//! test reaches ngrok.

#[path = "support/qa.rs"]
mod qa;
#[path = "support/mobile_monitor.rs"]
mod support;

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};

use agent_board::file_store::FileStore;
use serde_json::json;
use support::home;

#[path = "support/ngrok_harness.rs"]
mod harness;
use harness::*;

const SESSION: &str = "agboard_ngrok_session";
const DEVICE: &str = "agboard_ngrok_device";
const IPHONE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

fn project_of(home: &Path) -> String {
    FileStore::open(&home.join("shared"))
        .project_by_name("monitor")
        .unwrap()
        .id
        .to_string()
}

fn up(home: &Path) -> Server {
    let s = Server::start(
        home,
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    if s.get()["status"] != "ready" {
        assert_eq!(
            s.put(true, s.get()["revision"].as_u64().unwrap()).status,
            200
        );
        assert_eq!(s.start_ngrok(json!({})).status, 202);
    }
    s.wait_status("ready");
    s
}

fn backend(s: &Server) -> SocketAddr {
    backend_addr(s.mock.calls.lock().unwrap().last().unwrap())
}

/// A request as the Edge forwards it, with the cookies a browser would send.
fn call(
    s: &Server,
    method: &str,
    path: &str,
    cookies: &str,
    extra: &[(&str, &str)],
    body: &str,
) -> Reply {
    let mut headers = vec![("Host", PUBLIC.trim_start_matches("https://"))];
    if !cookies.is_empty() {
        headers.push(("Cookie", cookies));
    }
    headers.extend_from_slice(extra);
    request(backend(s), method, path, &headers, body)
}

fn unlock(s: &Server, code: &str, cookies: &str) -> Reply {
    call(
        s,
        "POST",
        "/api/remote/unlock",
        cookies,
        &[
            ("Origin", PUBLIC),
            ("Sec-Fetch-Site", "same-origin"),
            ("Content-Type", "application/json"),
            ("User-Agent", IPHONE),
        ],
        &json!({"code": code}).to_string(),
    )
}

fn ask_session(s: &Server, cookies: &str) -> Reply {
    call(
        s,
        "GET",
        "/api/remote/session",
        cookies,
        &[("Sec-Fetch-Site", "same-origin")],
        "",
    )
}

fn cookie_of(r: &Reply, name: &str) -> Option<String> {
    r.headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|c| c.starts_with(&format!("{name}=")))
        .map(str::to_string)
}

fn pair(set_cookie: &str) -> String {
    set_cookie.split(';').next().unwrap().to_string()
}

fn read(s: &Server, home: &Path, cookies: &str) -> Reply {
    call(
        s,
        "GET",
        &format!("/api/projects/{}/summary", project_of(home)),
        cookies,
        &[],
        "",
    )
}

fn fixture() -> tempfile::TempDir {
    let home = home();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.project_by_name("monitor").unwrap().id;
    qa::ask(
        &store,
        &project,
        &[1],
        "Pick one",
        &[("a", "A"), ("b", "B")],
    );
    home
}

/// Register a phone with the passcode: its two cookies as the browser would send them.
fn register(s: &Server) -> (String, String) {
    let r = unlock(s, &s.passcode(), "");
    assert_eq!(r.status, 200, "{}", r.body);
    (
        pair(&cookie_of(&r, SESSION).unwrap()),
        pair(&cookie_of(&r, DEVICE).expect("a right passcode registers the device")),
    )
}

fn devices(s: &Server) -> serde_json::Value {
    let r = request(s.local, "GET", "/api/monitor-connections/devices", &[], "");
    assert_eq!(r.status, 200, "{}", r.body);
    r.json()["devices"].clone()
}

fn open_events(s: &Server, cookie: &str) -> TcpStream {
    let mut stream = TcpStream::connect(backend(s)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let head = format!(
        "GET /api/events HTTP/1.1\r\nHost: {}\r\nCookie: {cookie}\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n",
        PUBLIC.trim_start_matches("https://")
    );
    stream.write_all(head.as_bytes()).unwrap();
    let mut seen = String::new();
    let mut buf = [0u8; 1024];
    let end = Instant::now() + Duration::from_secs(5);
    while Instant::now() < end && !seen.contains("\r\n\r\n") {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => seen.push_str(&String::from_utf8_lossy(&buf[..n])),
        }
    }
    assert!(seen.starts_with("HTTP/1.1 200"), "{seen}");
    stream
}

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

#[test]
fn a_right_passcode_registers_the_device_and_only_a_digest_is_kept() {
    let home = fixture();
    let s = up(home.path());
    // A wrong passcode registers nothing.
    let wrong = if s.passcode() == "0000" {
        "0001"
    } else {
        "0000"
    };
    let r = unlock(&s, wrong, "");
    assert_eq!(r.status, 403);
    assert!(r.headers.get("set-cookie").is_none());
    assert!(devices(&s).as_array().unwrap().is_empty());

    let r = unlock(&s, &s.passcode(), "");
    assert_eq!(r.status, 200);
    let device = cookie_of(&r, DEVICE).unwrap();
    for part in [
        "; Secure",
        "; HttpOnly",
        "; SameSite=Lax",
        "; Path=/",
        "; Max-Age=34560000",
    ] {
        assert!(device.contains(part), "{part} in {device}");
    }
    let token = pair(&device)[DEVICE.len() + 1..].to_string();
    assert_eq!(token.len(), 64);
    assert!(!r.body.contains(&token));

    // The PC sees a label, never the token.
    let list = devices(&s);
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["label"], "iPhone / Safari");
    assert!(list[0]["id"].as_str().unwrap().starts_with("dev_"));
    assert!(!list.to_string().contains(&token));

    // Only a digest is on disk, in an owner-only file.
    let disk = all_files_text(home.path());
    assert!(!disk.contains(&token), "the device token reached the disk");
    let file = home.path().join(".internal/remote-devices.json");
    assert!(file.is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&file).unwrap().permissions().mode() & 0o077,
            0
        );
    }

    // Entering the passcode again with the device cookie keeps one device.
    let again = unlock(&s, &s.passcode(), &pair(&device));
    assert_eq!(again.status, 200);
    assert!(cookie_of(&again, DEVICE).is_none());
    assert_eq!(devices(&s).as_array().unwrap().len(), 1);
}

#[test]
fn a_registered_device_comes_back_without_the_passcode_after_a_restart() {
    let home = fixture();
    let (session, device, old_passcode) = {
        let s = up(home.path());
        let (session, device) = register(&s);
        assert_eq!(read(&s, home.path(), &session).status, 200);
        (session, device, s.passcode())
    };

    // The PC restarts: the tunnel is restored with a new passcode and the old session is gone.
    let s = up(home.path());
    assert_eq!(read(&s, home.path(), &session).status, 401);
    // A browser that was never registered, or sends a made-up device cookie, is asked.
    let none = ask_session(&s, "");
    assert_eq!(none.status, 401);
    assert!(none.headers.get("set-cookie").is_none());
    assert_eq!(
        ask_session(&s, &format!("{DEVICE}={}", "0".repeat(64))).status,
        401
    );
    assert_eq!(read(&s, home.path(), &device).status, 401);
    // The old passcode does not open the new run either.
    if s.passcode() != old_passcode {
        assert_eq!(unlock(&s, &old_passcode, "").status, 403);
    }

    // The registered device gets a session at once, and it works.
    let back = ask_session(&s, &device);
    assert_eq!(back.status, 200, "{}", back.body);
    let fresh = pair(&cookie_of(&back, SESSION).unwrap());
    assert_ne!(fresh, session);
    assert!(
        cookie_of(&back, DEVICE).is_some(),
        "an active device is kept registered"
    );
    assert_eq!(back.json()["csrfToken"].as_str().unwrap().len(), 64);
    assert_eq!(read(&s, home.path(), &fresh).status, 200);
    assert_eq!(devices(&s).as_array().unwrap().len(), 1);

    // The same goes for a session that simply ended while the PC kept running.
    assert_eq!(
        ask_session(&s, &format!("{SESSION}=gone; {device}")).status,
        200
    );
}

#[test]
fn the_passcode_limit_stays_and_a_locked_run_still_lets_registered_devices_in() {
    let home = fixture();
    let s = up(home.path());
    let (_, device) = register(&s);
    let wrong = if s.passcode() == "0000" {
        "0001"
    } else {
        "0000"
    };
    for _ in 0..5 {
        assert_eq!(unlock(&s, wrong, "").status, 403);
    }
    assert_eq!(unlock(&s, &s.passcode(), "").status, 429);
    assert_eq!(devices(&s).as_array().unwrap().len(), 1);
    assert_eq!(ask_session(&s, &device).status, 200);
}

#[test]
fn pausing_stops_public_access_and_resuming_brings_registered_devices_back() {
    let home = fixture();
    let s = up(home.path());
    let (session, device) = register(&s);
    let paused_at = backend(&s);
    let stream = open_events(&s, &session);

    // Pause: the connection stops, the open stream ends and nothing is served.
    assert_eq!(s.stop_ngrok().status, 200);
    s.wait_status("disabled");
    assert!(stream_ends(stream, Duration::from_secs(5)));
    std::thread::sleep(Duration::from_millis(100));
    assert!(TcpStream::connect_timeout(&paused_at, Duration::from_millis(300)).is_err());
    // The registrations are kept while paused.
    assert_eq!(devices(&s).as_array().unwrap().len(), 1);

    // Resume: the same server starts the tunnel again with a new passcode.
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    s.wait_status("ready");
    assert_eq!(read(&s, home.path(), &session).status, 401);
    let back = ask_session(&s, &device);
    assert_eq!(back.status, 200);
    let fresh = pair(&cookie_of(&back, SESSION).unwrap());
    assert_eq!(read(&s, home.path(), &fresh).status, 200);
}

#[test]
fn unregistering_ends_live_sessions_and_streams_and_the_device_is_asked_for_the_code() {
    let home = fixture();
    let s = up(home.path());
    let (session, device) = register(&s);
    let first = devices(&s)[0]["id"].as_str().unwrap().to_string();
    // A second phone stays registered.
    let (other_session, other_device) = register(&s);
    assert_eq!(devices(&s).as_array().unwrap().len(), 2);
    let stream = open_events(&s, &session);
    let other_stream = open_events(&s, &other_session);
    assert_eq!(read(&s, home.path(), &session).status, 200);

    let path = format!("/api/monitor-connections/devices/{first}");
    let removed = s.write("DELETE", &path, &json!({}));
    assert_eq!(removed.status, 200, "{}", removed.body);
    let left = removed.json()["devices"].clone();
    assert_eq!(left.as_array().unwrap().len(), 1);
    assert_ne!(left[0]["id"], first.as_str());

    // The session that was still valid ends, with its stream, and the code is asked for again.
    assert_eq!(read(&s, home.path(), &session).status, 401);
    assert!(stream_ends(stream, Duration::from_secs(5)));
    assert_eq!(ask_session(&s, &format!("{session}; {device}")).status, 401);
    assert_eq!(ask_session(&s, &device).status, 401);
    // The code registers it again, as a new device.
    let (_, again) = register(&s);
    assert_ne!(again, device);
    assert_eq!(devices(&s).as_array().unwrap().len(), 2);

    // The other phone is untouched.
    assert_eq!(read(&s, home.path(), &other_session).status, 200);
    assert!(!stream_ends(other_stream, Duration::from_millis(600)));
    assert_eq!(ask_session(&s, &other_device).status, 200);

    // A device that is gone, or never was, is not found; the file keeps no trace of the first.
    assert_eq!(s.write("DELETE", &path, &json!({})).status, 404);
    assert_eq!(
        s.write(
            "DELETE",
            "/api/monitor-connections/devices/dev_nope",
            &json!({})
        )
        .status,
        404
    );
    assert!(!all_files_text(home.path()).contains(&first));
}

#[test]
fn the_device_list_is_for_the_pc_only() {
    let home = fixture();
    let s = up(home.path());
    let (session, device) = register(&s);
    let id = devices(&s)[0]["id"].as_str().unwrap().to_string();
    let cookies = format!("{session}; {device}");
    // Not served at the entrance, session or not.
    for (method, path) in [
        ("GET", "/api/monitor-connections/devices".to_string()),
        ("DELETE", format!("/api/monitor-connections/devices/{id}")),
    ] {
        let r = call(
            &s,
            method,
            &path,
            &cookies,
            &[("Origin", PUBLIC), ("Sec-Fetch-Site", "same-origin")],
            "",
        );
        assert!(
            matches!(r.status, 403 | 404),
            "{method} {path}: {}",
            r.status
        );
    }
    assert_eq!(devices(&s).as_array().unwrap().len(), 1);
    // A write on the PC listener needs the page token.
    let origin = format!("http://127.0.0.1:{}", s.local.port());
    let r = request(
        s.local,
        "DELETE",
        &format!("/api/monitor-connections/devices/{id}"),
        &[("Origin", &origin), ("Sec-Fetch-Site", "same-origin")],
        "",
    );
    assert_eq!(r.status, 403);
    assert_eq!(devices(&s).as_array().unwrap().len(), 1);
}
