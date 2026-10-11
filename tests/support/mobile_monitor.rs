#![allow(dead_code)]

use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::Duration;

use agent_board::domain::{Actor, Assignee, NewCard};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::server::{RemoteServeConfig, ServeConfig, run_until_with_remote};

static ENV_LOCK: Mutex<()> = Mutex::new(());
pub const ORIGIN: &str = "https://monitor.example";
pub const ORIGIN2: &str = "https://tail.example:8443";

pub fn home() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let files = FileStore::open(&home.path().join("shared"));
    let id = files
        .create_project("monitor", chrono::Utc::now())
        .unwrap()
        .id;
    files.create_card(&id, NewCard {
        title: "Sample".into(),
        description: "## 作業内容\n\nRead-only fixture\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Verify\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n".into(),
        assignee: Assignee::Ai,
        actor: Actor::Ai,
        is_draft: false,
    }, chrono::Utc::now()).unwrap();
    home
}

pub struct Running {
    pub local: SocketAddr,
    pub remote: SocketAddr,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    handle: Option<JoinHandle<Result<(), AgboardError>>>,
}

impl Running {
    pub fn start(home: &Path) -> Self {
        let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = home.to_path_buf();
        let (ready_tx, ready_rx) = mpsc::channel();
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
        let handle = std::thread::spawn(move || {
            unsafe { std::env::set_var("AGBOARD_HOME", &home) };
            let result = run_until_with_remote(
                ServeConfig { port: 0 },
                Some(RemoteServeConfig {
                    port: 0,
                    origins: vec![ORIGIN.into(), ORIGIN2.into()],
                }),
                async move {
                    let _ = stop_rx.await;
                },
                move |local, remote| {
                    unsafe { std::env::remove_var("AGBOARD_HOME") };
                    let _ = ready_tx.send((local, remote.unwrap()));
                },
            );
            unsafe { std::env::remove_var("AGBOARD_HOME") };
            result
        });
        let (local, remote) = match ready_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(addresses) => addresses,
            Err(error) => panic!(
                "server did not become ready: {error}; result: {:?}",
                handle.join()
            ),
        };
        Self {
            local,
            remote,
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

    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.remote.port())
    }

    pub fn request(&self, method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> Reply {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(5)))
            .build()
            .into();
        let mut req = ureq::http::Request::builder()
            .method(method)
            .uri(self.url(path));
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

    pub fn monitor_headers(&self) -> [(&'static str, &'static str); 1] {
        [("Host", "monitor.example")]
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
