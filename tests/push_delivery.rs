//! Web Push delivery of board changes over a real server on loopback. A mock connector stands in
//! for the tunnel and a recording transport for the push services, so nothing leaves the machine.
//! The test phone holds a real P-256 key and opens the messages the way a browser does.

#[path = "support/qa.rs"]
mod qa;
#[path = "support/mobile_monitor.rs"]
mod support;

use std::path::Path;
use std::time::{Duration, Instant};

use agent_board::domain::{Actor, ChangeContext, Column, ResultKind};
use agent_board::file_store::{FileStore, ResultInput};
use agent_board::server::push_delivery::Request;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use ring::aead::{AES_128_GCM, Aad, LessSafeKey, Nonce, UnboundKey};
use ring::agreement::{ECDH_P256, EphemeralPrivateKey, UnparsedPublicKey, agree_ephemeral};
use ring::hkdf::{self, HKDF_SHA256, KeyType};
use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{Value, json};
use support::home;

#[path = "support/ngrok_harness.rs"]
mod harness;
use harness::*;

const SESSION: &str = "agboard_ngrok_session";
const DEVICE: &str = "agboard_ngrok_device";
const ENDPOINT: &str = "https://web.push.apple.com/QGexample";

struct Len(usize);

impl KeyType for Len {
    fn len(&self) -> usize {
        self.0
    }
}

fn expand(prk: &hkdf::Prk, info: &[u8], out: &mut [u8]) {
    prk.expand(&[info], Len(out.len()))
        .unwrap()
        .fill(out)
        .unwrap();
}

/// A phone's push keys and what it takes to open a message (RFC 8291, Section 4).
struct Phone {
    private: Option<EphemeralPrivateKey>,
    public: Vec<u8>,
    auth: [u8; 16],
    cookies: String,
    csrf: String,
}

impl Phone {
    fn open(&mut self, request: &Request) -> Value {
        let message = &request.body;
        let salt = &message[..16];
        let sender = &message[21..86];
        let secret = agree_ephemeral(
            self.private.take().expect("one message per phone key"),
            &UnparsedPublicKey::new(&ECDH_P256, sender),
            |s| s.to_vec(),
        )
        .unwrap();
        let mut info = b"WebPush: info\0".to_vec();
        info.extend_from_slice(&self.public);
        info.extend_from_slice(sender);
        let mut ikm = [0u8; 32];
        expand(
            &hkdf::Salt::new(HKDF_SHA256, &self.auth).extract(&secret),
            &info,
            &mut ikm,
        );
        let prk = hkdf::Salt::new(HKDF_SHA256, salt).extract(&ikm);
        let (mut cek, mut nonce) = ([0u8; 16], [0u8; 12]);
        expand(&prk, b"Content-Encoding: aes128gcm\0", &mut cek);
        expand(&prk, b"Content-Encoding: nonce\0", &mut nonce);
        let mut record = message[86..].to_vec();
        let plain = LessSafeKey::new(UnboundKey::new(&AES_128_GCM, &cek).unwrap())
            .open_in_place(
                Nonce::assume_unique_for_key(nonce),
                Aad::empty(),
                &mut record,
            )
            .unwrap();
        serde_json::from_slice(&plain[..plain.len() - 1]).unwrap()
    }
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

fn cookie(r: &Reply, name: &str) -> String {
    r.headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|c| c.starts_with(&format!("{name}=")))
        .map(|c| c.split(';').next().unwrap().to_string())
        .unwrap()
}

/// Start the server with the entrance up, register a phone, and subscribe it with a key it holds.
fn subscribed_phone(s: &Server) -> Phone {
    if s.get()["status"] != "ready" {
        assert_eq!(
            s.put(true, s.get()["revision"].as_u64().unwrap()).status,
            200
        );
        assert_eq!(s.start_ngrok(json!({})).status, 202);
    }
    s.wait_status("ready");
    let unlock = call(
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
    assert_eq!(unlock.status, 200, "{}", unlock.body);
    let cookies = format!("{}; {}", cookie(&unlock, SESSION), cookie(&unlock, DEVICE));
    let csrf = unlock.json()["csrfToken"].as_str().unwrap().to_string();

    let rng = SystemRandom::new();
    let private = EphemeralPrivateKey::generate(&ECDH_P256, &rng).unwrap();
    let public = private.compute_public_key().unwrap().as_ref().to_vec();
    let mut auth = [0u8; 16];
    rng.fill(&mut auth).unwrap();
    let body = json!({
        "endpoint": ENDPOINT,
        "keys": { "p256dh": B64.encode(&public), "auth": B64.encode(auth) },
    });
    let put = call(
        s,
        "PUT",
        "/api/remote/push/subscription",
        &cookies,
        &[
            ("Origin", PUBLIC),
            ("Sec-Fetch-Site", "same-origin"),
            ("Content-Type", "application/json"),
            ("X-Agboard-Csrf", &csrf),
        ],
        &body.to_string(),
    );
    assert_eq!(put.status, 200, "{}", put.body);
    Phone {
        private: Some(private),
        public,
        auth,
        cookies,
        csrf,
    }
}

fn settings(s: &Server, body: Value) {
    assert_eq!(
        s.write("PUT", "/api/notification-settings", &body).status,
        200
    );
}

fn wait_for(s: &Server, count: usize) -> Vec<Request> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let sent = s.push.requests.lock().unwrap().clone();
        if sent.len() >= count {
            return sent;
        }
        assert!(
            Instant::now() < deadline,
            "only {} of {count} messages",
            sent.len()
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Wait long enough for a change to have been looked at, then count the messages.
fn settled(s: &Server) -> usize {
    std::thread::sleep(Duration::from_millis(2500));
    s.push.requests.lock().unwrap().len()
}

fn start(home: &Path) -> Server {
    Server::start(
        home,
        Opts {
            env_token: true,
            ..Opts::default()
        },
    )
}

fn ctx(reason: &str) -> ChangeContext {
    ChangeContext {
        actor: Actor::Ai,
        reason: reason.into(),
    }
}

fn progress(summary: &str) -> ResultInput {
    ResultInput {
        kind: ResultKind::Progress,
        summary: summary.into(),
        link: None,
        images: Vec::new(),
        key: None,
    }
}

#[test]
fn results_questions_and_chosen_changes_reach_the_phone_once_each() {
    let home = home();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.project_by_name("monitor").unwrap().id;
    let s = start(home.path());
    let mut phone = subscribed_phone(&s);
    let _ = (&phone.cookies, &phone.csrf);

    // AC-1: the first viewable result of a task in progress sends a link to that version.
    store
        .move_work_task(
            &project,
            1,
            Column::Doing,
            ctx("Started"),
            chrono::Utc::now(),
        )
        .unwrap();
    assert_eq!(
        settled(&s),
        0,
        "a state change alone sends nothing by default"
    );
    store
        .add_result(
            &project,
            1,
            progress("First draft of the screen"),
            chrono::Utc::now(),
        )
        .unwrap();
    let sent = wait_for(&s, 1);
    let first = phone.open(&sent[0]);
    assert_eq!(
        first["url"],
        format!("{PUBLIC}/?project={project}&task=1&result=1")
    );
    assert!(first["tag"].as_str().unwrap().starts_with("result:1:"));
    assert!(
        first["body"]
            .as_str()
            .unwrap()
            .contains("First draft of the screen")
    );
    assert_eq!(sent[0].urgency, "normal");
    assert_eq!(sent[0].endpoint, ENDPOINT);

    // The board still holds the result, and a second read of it sends nothing more.
    assert_eq!(settled(&s), 1);
    s.write("POST", "/api/notify", &json!({}));
    assert_eq!(settled(&s), 1);
}

#[test]
fn a_question_is_urgent_and_one_event_is_one_notification() {
    let home = home();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.project_by_name("monitor").unwrap().id;
    let s = start(home.path());
    let mut phone = subscribed_phone(&s);
    // Every kind is on, so one question matches several of them: it also adds history.
    settings(
        &s,
        json!({"kinds": {"results": true, "questions": true, "history": true}}),
    );
    qa::ask(
        &store,
        &project,
        &[1],
        "Pick one",
        &[("a", "A"), ("b", "B")],
    );
    let sent = wait_for(&s, 1);
    assert_eq!(settled(&s), 1, "one notification for the one event");
    assert_eq!(sent[0].urgency, "high");
    let message = phone.open(&sent[0]);
    assert_eq!(
        message["url"],
        format!("{PUBLIC}/?project={project}&task=1&question=Q-1")
    );
    assert!(message["tag"].as_str().unwrap().starts_with("question:"));
}

#[test]
fn kinds_that_are_off_send_nothing() {
    let home = home();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.project_by_name("monitor").unwrap().id;
    let s = start(home.path());
    let _phone = subscribed_phone(&s);
    settings(
        &s,
        json!({"kinds": {"results": false, "questions": false, "history": false}}),
    );
    store
        .move_work_task(
            &project,
            1,
            Column::Doing,
            ctx("Started"),
            chrono::Utc::now(),
        )
        .unwrap();
    store
        .add_result(&project, 1, progress("Not wanted"), chrono::Utc::now())
        .unwrap();
    store
        .add_history(&project, 1, Some("A note"), chrono::Utc::now())
        .unwrap();
    assert_eq!(settled(&s), 0);
}

#[test]
fn what_was_sent_is_not_sent_again_after_a_restart() {
    let home = home();
    let store = FileStore::open(&home.path().join("shared"));
    let project = store.project_by_name("monitor").unwrap().id;
    {
        let s = start(home.path());
        let _phone = subscribed_phone(&s);
        store
            .add_result(&project, 1, progress("Draft"), chrono::Utc::now())
            .unwrap();
        wait_for(&s, 1);
    }
    let s = start(home.path());
    s.wait_status("ready");
    // The restarted board shows the same result; the phone is not told again.
    assert_eq!(settled(&s), 0);
    store
        .add_result(&project, 1, progress("Second draft"), chrono::Utc::now())
        .unwrap();
    wait_for(&s, 1);
}
