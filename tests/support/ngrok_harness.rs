//! A fake-connector harness for the ngrok monitor connection: a real server on
//! loopback whose tunnel is opened by a connector that never touches the network.

#![allow(dead_code)]

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use agent_board::error::AgboardError;
use agent_board::server::monitor_connection::contracts::PublicOrigin;
use agent_board::server::monitor_connection::keychain::{TokenVault, VaultError};
use agent_board::server::monitor_connection::lifecycle::{
    Connector, FailureCode, MonitorEnv, OpenFailure, OpenFuture, OpenRequest, OpenedTunnel,
    Overrides, Secret,
};
use agent_board::server::{MonitorOptions, MonitorReady, ServeConfig, run_until_with_monitor};
use serde_json::{Value, json};

use super::support::token;

pub const TOKEN: &str = "tok-SECRET-0123456789";
pub const PUBLIC: &str = "https://fake-abc.ngrok.app";
static ENV_LOCK: Mutex<()> = Mutex::new(());

// ------------------------------------------------------------- the harness

pub struct Call {
    pub token: String,
    pub backend: String,
    pub domain: Option<String>,
}

#[derive(Default)]
pub struct Fake {
    pub calls: Mutex<Vec<Call>>,
    pub opens: AtomicUsize,
    pub fail: Mutex<bool>,
    /// When set, `open` waits for a message before it answers.
    pub hold: Mutex<Option<mpsc::Receiver<()>>>,
    /// The public origin the next tunnel reports; `PUBLIC` when unset.
    pub public: Mutex<Option<String>>,
}

impl Connector for Fake {
    fn open(&self, request: OpenRequest) -> OpenFuture {
        self.opens.fetch_add(1, Ordering::SeqCst);
        self.calls.lock().unwrap().push(Call {
            token: request.token.expose().to_string(),
            backend: request.backend.to_string(),
            domain: request.domain.clone(),
        });
        let fail = *self.fail.lock().unwrap();
        let hold = self.hold.lock().unwrap().take();
        let public = self
            .public
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| PUBLIC.to_string());
        Box::pin(async move {
            if let Some(rx) = hold {
                tokio::task::spawn_blocking(move || {
                    let _ = rx.recv_timeout(Duration::from_secs(20));
                })
                .await
                .unwrap();
            }
            if fail {
                return Err(OpenFailure {
                    code: FailureCode::ConnectFailed,
                });
            }
            Ok(OpenedTunnel {
                public: PublicOrigin::parse(&public).unwrap(),
                keep_alive: Box::new(()),
            })
        })
    }
}

pub struct Reply {
    pub status: u16,
    pub body: String,
    pub headers: ureq::http::HeaderMap,
}

impl Reply {
    pub fn header(&self, name: &str) -> Option<String> {
        self.headers
            .get(name)
            .map(|v| v.to_str().unwrap_or_default().to_string())
    }

    pub fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or(Value::Null)
    }
}

pub fn request(
    addr: std::net::SocketAddr,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> Reply {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(5)))
        .build()
        .into();
    let mut req = ureq::http::Request::builder()
        .method(method)
        .uri(format!("http://{addr}{path}"));
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let mut response = agent.run(req.body(body.to_owned()).unwrap()).unwrap();
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let body = response.body_mut().read_to_string().unwrap_or_default();
    Reply {
        status,
        body,
        headers,
    }
}

pub struct Server {
    pub local: std::net::SocketAddr,
    pub token: String,
    pub fake: Arc<Fake>,
    pub ready: Option<MonitorReady>,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    handle: Option<JoinHandle<Result<(), AgboardError>>>,
}

/// A keychain in memory: saved tokens, a switch to make it unusable, and a count
/// of reads so a test can show the keychain was left alone.
pub struct FakeVault {
    saved: Mutex<Option<String>>,
    usable: bool,
    pub loads: AtomicUsize,
}

impl FakeVault {
    pub fn new(saved: Option<&str>, usable: bool) -> Arc<Self> {
        Arc::new(Self {
            saved: Mutex::new(saved.map(str::to_owned)),
            usable,
            loads: AtomicUsize::new(0),
        })
    }
    pub fn saved(&self) -> Option<String> {
        self.saved.lock().unwrap().clone()
    }
}

impl TokenVault for FakeVault {
    fn available(&self) -> bool {
        self.usable
    }
    fn load(&self) -> Result<Option<Secret>, VaultError> {
        self.loads.fetch_add(1, Ordering::SeqCst);
        if !self.usable {
            return Err(VaultError::Unavailable);
        }
        Ok(self.saved().map(Secret::new))
    }
    fn save(&self, token: &Secret) -> Result<(), VaultError> {
        if !self.usable {
            return Err(VaultError::Unavailable);
        }
        *self.saved.lock().unwrap() = Some(token.expose().to_owned());
        Ok(())
    }
    fn delete(&self) -> Result<(), VaultError> {
        if !self.usable {
            return Err(VaultError::Unavailable);
        }
        *self.saved.lock().unwrap() = None;
        Ok(())
    }
}

pub struct Opts {
    pub vault: Arc<FakeVault>,
    pub env_token: bool,
    pub explicit: Option<Overrides>,
    pub fake: Arc<Fake>,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            vault: FakeVault::new(None, true),
            env_token: false,
            explicit: None,
            fake: Arc::new(Fake::default()),
        }
    }
}

impl Server {
    pub fn try_start(home: &Path, opts: Opts) -> Result<Self, AgboardError> {
        let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // SAFETY: startup holds ENV_LOCK and the path is read once at startup.
        unsafe { std::env::set_var("AGBOARD_HOME", home) };
        let (tx, rx) = mpsc::channel();
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
        let monitor = MonitorOptions {
            env: MonitorEnv {
                token: opts.env_token.then(|| Secret::new(TOKEN)),
            },
            explicit: opts.explicit,
            connector: opts.fake.clone(),
            vault: opts.vault.clone(),
        };
        let handle = std::thread::spawn(move || {
            run_until_with_monitor(
                ServeConfig { port: 0 },
                monitor,
                async move {
                    let _ = stop_rx.await;
                },
                move |local, ready| {
                    let _ = tx.send((local, ready));
                },
            )
        });
        let got = rx.recv_timeout(Duration::from_secs(15));
        // SAFETY: same lock; the server has captured the path.
        unsafe { std::env::remove_var("AGBOARD_HOME") };
        match got {
            Ok((local, ready)) => {
                let page = request(local, "GET", "/", &[], "").body;
                Ok(Self {
                    local,
                    token: token(&page),
                    fake: opts.fake,
                    ready,
                    stop: Some(stop_tx),
                    handle: Some(handle),
                })
            }
            Err(_) => {
                let _ = stop_tx.send(());
                handle
                    .join()
                    .unwrap()
                    .map(|()| unreachable!("server never became ready"))
            }
        }
    }

    pub fn start(home: &Path, opts: Opts) -> Self {
        Self::try_start(home, opts).unwrap_or_else(|e| panic!("did not start: {e}"))
    }

    /// A write that passes the page guard.
    pub fn write(&self, method: &str, path: &str, body: &Value) -> Reply {
        let origin = format!("http://127.0.0.1:{}", self.local.port());
        request(
            self.local,
            method,
            path,
            &[
                ("Origin", &origin),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Token", &self.token),
                ("Content-Type", "application/json"),
            ],
            &body.to_string(),
        )
    }

    pub fn get(&self) -> Value {
        let r = request(self.local, "GET", "/api/monitor-connections", &[], "");
        assert_eq!(r.status, 200, "{}", r.body);
        r.json()
    }

    pub fn put(&self, enabled: bool, domain: Option<&str>, revision: u64) -> Reply {
        self.write(
            "PUT",
            "/api/monitor-connections/settings/ngrok",
            &json!({"enabled": enabled, "domain": domain, "revision": revision}),
        )
    }

    /// The passcode the PC shows for the running connection.
    pub fn passcode(&self) -> String {
        self.get()["passcode"]
            .as_str()
            .expect("a ready connection shows its passcode")
            .to_string()
    }

    pub fn start_ngrok(&self, body: Value) -> Reply {
        self.write(
            "POST",
            "/api/monitor-connections/transports/ngrok/start",
            &body,
        )
    }

    pub fn stop_ngrok(&self) -> Reply {
        self.write(
            "POST",
            "/api/monitor-connections/transports/ngrok/stop",
            &json!({}),
        )
    }

    pub fn wait_status(&self, want: &str) -> Value {
        let end = Instant::now() + Duration::from_secs(10);
        loop {
            let v = self.get();
            if v["status"] == want {
                return v;
            }
            assert!(
                Instant::now() < end,
                "status stayed {} (wanted {want})",
                v["status"]
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

pub fn backend_addr(call: &Call) -> std::net::SocketAddr {
    call.backend
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .parse()
        .unwrap()
}

pub fn all_files_text(dir: &Path) -> String {
    let mut out = String::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            out.push_str(&all_files_text(&path));
        } else if let Ok(bytes) = std::fs::read(&path) {
            out.push_str(&String::from_utf8_lossy(&bytes));
        }
        out.push_str(&path.to_string_lossy());
    }
    out
}
