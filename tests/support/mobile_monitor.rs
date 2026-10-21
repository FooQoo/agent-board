#![allow(dead_code)]

use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::Duration;

use agent_board::domain::{Actor, Assignee, NewTask};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::server::monitor_connection::contracts::PublicOrigin;
use agent_board::server::monitor_connection::lifecycle::{
    Connector, MonitorEnv, OpenFuture, OpenRequest, OpenedTunnel, Overrides, Secret,
};
use agent_board::server::{MonitorOptions, ServeConfig, run_until_with_monitor};
use serde_json::Value;

static ENV_LOCK: Mutex<()> = Mutex::new(());
/// The public origin the fake tunnel reports.
pub const ORIGIN: &str = "https://fixture-run.ngrok.app";
const EMAIL: &str = "owner@example.com";

pub fn home() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let files = FileStore::open(&home.path().join("shared"));
    let id = files
        .create_project("monitor", chrono::Utc::now())
        .unwrap()
        .id;
    files.create_task(&id, NewTask {
        title: "Sample".into(),
        description: "## 作業内容\n\nRead-only fixture\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Verify\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n".into(),
        assignee: Assignee::Ai,
        actor: Actor::Ai,
        is_draft: false,
    }, chrono::Utc::now()).unwrap();
    home
}

/// Records the newest tunnel request instead of opening a tunnel.
#[derive(Default)]
struct RecordingConnector {
    last: Mutex<Option<(SocketAddr, String)>>,
}

impl Connector for RecordingConnector {
    fn open(&self, request: OpenRequest) -> OpenFuture {
        let addr = request
            .backend
            .as_str()
            .trim_start_matches("http://")
            .trim_end_matches('/')
            .parse()
            .unwrap();
        let proof = serde_json::from_str::<Value>(request.policy.expose()).unwrap()
            ["on_http_request"][3]["actions"][0]["config"]["headers"]["x-agboard-tunnel-proof"]
            .as_str()
            .unwrap()
            .to_string();
        *self.last.lock().unwrap() = Some((addr, proof));
        Box::pin(async {
            Ok(OpenedTunnel {
                public: PublicOrigin::parse(ORIGIN).unwrap(),
                keep_alive: Box::new(()),
            })
        })
    }
}

/// A session at the tunnel: the cookie header value and the CSRF token.
pub struct Session {
    pub cookie: String,
    pub csrf: String,
}

/// A real server on loopback whose tunnel is opened by a fake connector. The
/// monitor is reached the way the Edge forwards it: the public Host, the proof
/// and, for data, a session.
pub struct Running {
    pub local: SocketAddr,
    pub backend: SocketAddr,
    proof: String,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    handle: Option<JoinHandle<Result<(), AgboardError>>>,
}

impl Running {
    pub fn start(home: &Path) -> Self {
        let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let previous = std::env::var_os("AGBOARD_HOME");
        // SAFETY: startup and environment restoration hold ENV_LOCK. Server
        // shutdown never mutates the process environment.
        unsafe { std::env::set_var("AGBOARD_HOME", home) };
        let (ready_tx, ready_rx) = mpsc::channel();
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
        let connector = Arc::new(RecordingConnector::default());
        let seen = connector.clone();
        let handle = std::thread::spawn(move || {
            let mut options = MonitorOptions::without_keychain(
                MonitorEnv {
                    token: Some(Secret::new("tok-fixture-0123456789")),
                    google: None,
                },
                Some(Overrides {
                    allow_emails: vec![EMAIL.into()],
                    domain: None,
                    oauth_app: None,
                }),
            );
            options.connector = connector;
            run_until_with_monitor(
                ServeConfig { port: 0 },
                options,
                async move {
                    let _ = stop_rx.await;
                },
                move |local, _| {
                    let _ = ready_tx.send(local);
                },
            )
        });
        let ready = ready_rx.recv_timeout(Duration::from_secs(10));
        // SAFETY: the same startup lock still protects restoration, including
        // the error path. Every server path has already been captured.
        unsafe {
            match previous {
                Some(value) => std::env::set_var("AGBOARD_HOME", value),
                None => std::env::remove_var("AGBOARD_HOME"),
            }
        }
        let local = match ready {
            Ok(local) => local,
            Err(error) => {
                let _ = stop_tx.send(());
                panic!(
                    "server did not become ready: {error}; result: {:?}",
                    handle.join()
                );
            }
        };
        let (backend, proof) = seen
            .last
            .lock()
            .unwrap()
            .clone()
            .expect("a tunnel was opened");
        Self {
            local,
            backend,
            proof,
            stop: Some(stop_tx),
            handle: Some(handle),
        }
    }

    pub fn base(&self, home: &Path) -> String {
        let id = FileStore::open(&home.join("shared"))
            .project_by_name("monitor")
            .unwrap()
            .id;
        format!("/api/projects/{id}")
    }

    pub fn monitor_base(&self, home: &Path) -> String {
        let id = FileStore::open(&home.join("shared"))
            .project_by_name("monitor")
            .unwrap()
            .id;
        format!("/monitor/api/projects/{id}")
    }

    pub fn host(&self) -> &'static str {
        ORIGIN.trim_start_matches("https://")
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.backend)
    }

    /// The headers every request through the Edge carries: the public Host and
    /// the tunnel proof.
    pub fn edge_headers(&self) -> [(&'static str, String); 2] {
        [
            ("Host", self.host().to_string()),
            ("x-agboard-tunnel-proof", self.proof.clone()),
        ]
    }

    /// A request as the Edge forwards it. A `Host` in `headers` replaces the
    /// public one; the proof is always added.
    pub fn request(&self, method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> Reply {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(5)))
            .build()
            .into();
        let mut req = ureq::http::Request::builder()
            .method(method)
            .uri(self.url(path));
        if !headers
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("host"))
        {
            req = req.header("Host", self.host());
        }
        req = req.header("x-agboard-tunnel-proof", &self.proof);
        for (name, value) in headers {
            req = req.header(*name, *value);
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

    pub fn session(&self) -> Session {
        let reply = self.request(
            "GET",
            "/monitor/api/session",
            &[("Sec-Fetch-Site", "same-origin")],
            "",
        );
        assert_eq!(reply.status, 200, "{}", reply.body);
        let set = reply
            .header("set-cookie")
            .expect("a new session sets a cookie");
        let cookie = set.split(';').next().unwrap().to_string();
        let csrf = serde_json::from_str::<Value>(&reply.body).unwrap()["csrfToken"]
            .as_str()
            .unwrap()
            .to_string();
        Session { cookie, csrf }
    }

    /// A read with a session.
    pub fn get(&self, session: &Session, path: &str) -> Reply {
        self.request("GET", path, &[("Cookie", &session.cookie)], "")
    }

    /// A change that meets every condition of the entrance.
    pub fn write(&self, session: &Session, method: &str, path: &str, body: &str) -> Reply {
        self.request(
            method,
            path,
            &[
                ("Cookie", &session.cookie),
                ("Origin", ORIGIN),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Csrf", &session.csrf),
                ("Content-Type", "application/json"),
            ],
            body,
        )
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(handle) = self.handle.take() {
            handle.join().unwrap().unwrap();
        }
    }
}

pub struct Reply {
    pub status: u16,
    pub headers: ureq::http::HeaderMap,
    pub body: String,
}

impl Reply {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name)?.to_str().ok()
    }
}

pub fn token(html: &str) -> String {
    let marker = "name=\"agboard-token\" content=\"";
    let start = html.find(marker).expect("remote PC token meta") + marker.len();
    html[start..start + 64].to_string()
}
