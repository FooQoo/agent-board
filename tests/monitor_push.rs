//! Web Push subscriptions of registered devices over real HTTP on loopback: a registered phone
//! gets the VAPID public key and subscribes, the subscription survives a restart of the PC and
//! goes away with the device, and a session without a registered device cannot subscribe. A mock
//! connector stands in for the tunnel; nothing here reaches ngrok or a push service.

#[path = "support/qa.rs"]
mod qa;
#[path = "support/mobile_monitor.rs"]
mod support;

use std::path::Path;

use agent_board::file_store::FileStore;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use serde_json::{Value, json};
use support::home;

#[path = "support/ngrok_harness.rs"]
mod harness;
use harness::*;

const SESSION: &str = "agboard_ngrok_session";
const DEVICE: &str = "agboard_ngrok_device";
const ENDPOINT: &str = "https://web.push.apple.com/QGexample";

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

fn backend(s: &Server) -> std::net::SocketAddr {
    backend_addr(s.mock.calls.lock().unwrap().last().unwrap())
}

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

fn pair(r: &Reply, name: &str) -> Option<String> {
    r.headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|c| c.starts_with(&format!("{name}=")))
        .map(|c| c.split(';').next().unwrap().to_string())
}

/// A phone: the cookies it sends and the CSRF token of its session.
struct Phone {
    cookies: String,
    csrf: String,
    device: Option<String>,
}

fn unlock(s: &Server) -> Phone {
    let r = call(
        s,
        "POST",
        "/api/remote/unlock",
        "",
        &[
            ("Origin", PUBLIC),
            ("Sec-Fetch-Site", "same-origin"),
            ("Content-Type", "application/json"),
        ],
        &json!({"code": s.passcode()}).to_string(),
    );
    assert_eq!(r.status, 200, "{}", r.body);
    let session = pair(&r, SESSION).unwrap();
    let device = pair(&r, DEVICE);
    Phone {
        cookies: match &device {
            Some(d) => format!("{session}; {d}"),
            None => session,
        },
        csrf: r.json()["csrfToken"].as_str().unwrap().to_string(),
        device,
    }
}

/// The phone after the PC restarted: its device cookie opens a new session.
fn reconnect(s: &Server, device_cookie: &str) -> Phone {
    let r = call(
        s,
        "GET",
        "/api/remote/session",
        device_cookie,
        &[("Sec-Fetch-Site", "same-origin")],
        "",
    );
    assert_eq!(r.status, 200, "{}", r.body);
    Phone {
        cookies: format!("{}; {device_cookie}", pair(&r, SESSION).unwrap()),
        csrf: r.json()["csrfToken"].as_str().unwrap().to_string(),
        device: Some(device_cookie.to_string()),
    }
}

fn get_push(s: &Server, p: &Phone) -> Reply {
    call(
        s,
        "GET",
        "/api/remote/push",
        &p.cookies,
        &[("Sec-Fetch-Site", "same-origin")],
        "",
    )
}

fn write(s: &Server, p: &Phone, method: &str, body: &Value, csrf: bool) -> Reply {
    let mut extra = vec![
        ("Origin", PUBLIC),
        ("Sec-Fetch-Site", "same-origin"),
        ("Content-Type", "application/json"),
    ];
    if csrf {
        extra.push(("X-Agboard-Csrf", &p.csrf));
    }
    call(
        s,
        method,
        "/api/remote/push/subscription",
        &p.cookies,
        &extra,
        &body.to_string(),
    )
}

fn sub_body() -> Value {
    let mut key = vec![4u8];
    key.extend_from_slice(&[3u8; 64]);
    json!({
        "endpoint": ENDPOINT,
        "expirationTime": null,
        "keys": { "p256dh": B64.encode(key), "auth": B64.encode([5u8; 16]) },
    })
}

fn devices(s: &Server) -> Value {
    request(s.local, "GET", "/api/monitor-connections/devices", &[], "").json()["devices"].clone()
}

#[test]
fn a_registered_phone_gets_the_public_key_and_subscribes_and_unsubscribes() {
    let home = fixture();
    let s = up(home.path());
    let phone = unlock(&s);
    let r = get_push(&s, &phone);
    assert_eq!(r.status, 200, "{}", r.body);
    let key = r.json()["publicKey"].as_str().unwrap().to_string();
    assert_eq!(B64.decode(&key).unwrap().len(), 65);
    assert_eq!(r.json()["deviceRegistered"], true);
    assert_eq!(r.json()["subscribed"], false);

    let r = write(&s, &phone, "PUT", &sub_body(), true);
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(get_push(&s, &phone).json()["subscribed"], true);
    // A second subscription from the same device replaces the first.
    let mut again = sub_body();
    again["endpoint"] = json!("https://fcm.googleapis.com/fcm/send/other");
    assert_eq!(write(&s, &phone, "PUT", &again, true).status, 200);
    let disk =
        std::fs::read_to_string(home.path().join(".internal/push-subscriptions.json")).unwrap();
    assert!(disk.contains("fcm.googleapis.com") && !disk.contains("web.push.apple.com"));

    let r = write(&s, &phone, "DELETE", &json!({}), true);
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(get_push(&s, &phone).json()["subscribed"], false);
    // The key is never in a reply other than as the public key, and the private half is not sent.
    assert!(!r.body.contains("pkcs8"));
}

#[test]
fn bad_input_and_missing_checks_are_refused() {
    let home = fixture();
    let s = up(home.path());
    let phone = unlock(&s);
    // No session at all, and no CSRF token.
    assert_eq!(call(&s, "GET", "/api/remote/push", "", &[], "").status, 401);
    assert_eq!(write(&s, &phone, "PUT", &sub_body(), false).status, 403);
    for (field, value) in [
        ("endpoint", json!("http://web.push.apple.com/x")),
        ("endpoint", json!("https://127.0.0.1/x")),
        (
            "endpoint",
            json!(format!("https://web.push.apple.com/{}", "a".repeat(3000))),
        ),
    ] {
        let mut body = sub_body();
        body[field] = value;
        let r = write(&s, &phone, "PUT", &body, true);
        assert!(matches!(r.status, 400 | 413), "{}", r.body);
    }
    let mut body = sub_body();
    body["keys"]["auth"] = json!("AAAA");
    let r = write(&s, &phone, "PUT", &body, true);
    assert_eq!(r.status, 400);
    assert_eq!(r.json()["error"]["code"], "invalid_subscription");
    assert_eq!(
        write(&s, &phone, "PUT", &json!({"endpoint": ENDPOINT}), true).status,
        400
    );
    assert_eq!(get_push(&s, &phone).json()["subscribed"], false);
    assert_eq!(write(&s, &phone, "POST", &sub_body(), true).status, 405);
}

#[test]
fn the_subscription_survives_a_restart_and_the_key_stays_the_same() {
    let home = fixture();
    let (device, key) = {
        let s = up(home.path());
        let phone = unlock(&s);
        assert_eq!(write(&s, &phone, "PUT", &sub_body(), true).status, 200);
        (
            phone.device.clone().unwrap(),
            get_push(&s, &phone).json()["publicKey"].clone(),
        )
    };
    let s = up(home.path());
    let phone = reconnect(&s, &device);
    let r = get_push(&s, &phone);
    assert_eq!(r.json()["subscribed"], true);
    assert_eq!(r.json()["publicKey"], key);
    #[cfg(unix)]
    for name in ["vapid-key.json", "push-subscriptions.json"] {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(home.path().join(".internal").join(name))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "{name}");
    }
}

#[test]
fn unregistering_the_device_drops_its_subscription() {
    let home = fixture();
    let s = up(home.path());
    let phone = unlock(&s);
    assert_eq!(write(&s, &phone, "PUT", &sub_body(), true).status, 200);
    let id = devices(&s)[0]["id"].as_str().unwrap().to_string();
    let r = s.write(
        "DELETE",
        &format!("/api/monitor-connections/devices/{id}"),
        &json!({}),
    );
    assert_eq!(r.status, 200, "{}", r.body);
    let disk =
        std::fs::read_to_string(home.path().join(".internal/push-subscriptions.json")).unwrap();
    assert!(!disk.contains("web.push.apple.com"), "{disk}");
    // The session of the removed device ends, so it cannot subscribe again.
    assert_eq!(get_push(&s, &phone).status, 401);
}

#[cfg(unix)]
#[test]
fn a_session_without_a_registered_device_cannot_subscribe() {
    let home = fixture();
    // A device list that cannot be saved still lets the passcode open a session, with no device.
    let blocked = home.path().join(".internal/remote-devices.json");
    std::fs::create_dir_all(blocked.join("keep")).unwrap();
    let s = up(home.path());
    let phone = unlock(&s);
    assert!(phone.device.is_none());
    let r = get_push(&s, &phone);
    assert_eq!(r.status, 200);
    assert_eq!(r.json()["deviceRegistered"], false);
    assert!(r.json().get("publicKey").is_none());
    let r = write(&s, &phone, "PUT", &sub_body(), true);
    assert_eq!(r.status, 409, "{}", r.body);
    assert_eq!(r.json()["error"]["code"], "device_required");
    assert!(
        !home
            .path()
            .join(".internal/push-subscriptions.json")
            .exists()
    );
}

#[test]
fn the_manifest_and_worker_are_served_without_a_session_and_the_local_page_has_them_too() {
    let home = fixture();
    let s = up(home.path());
    let m = call(&s, "GET", "/manifest.webmanifest", "", &[], "");
    assert_eq!(m.status, 200);
    assert_eq!(
        m.header("content-type").unwrap(),
        "application/manifest+json"
    );
    assert_eq!(m.json()["display"], "standalone");
    let w = call(&s, "GET", "/sw.js", "", &[], "");
    assert_eq!(w.status, 200);
    assert!(
        w.header("content-type")
            .unwrap()
            .starts_with("text/javascript")
    );
    assert!(w.body.contains("notificationclick"));
    assert_eq!(request(s.local, "GET", "/sw.js", &[], "").status, 200);
}
