//! Shared harness for the epic, request, and shared-file HTTP and CLI tests.
//!
//! Servers listen on port 0 in a temporary data area. The CLI is the real
//! `agboard` binary run against the same `AGBOARD_HOME`.

#![allow(dead_code)]

use std::net::SocketAddr;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

use agent_board::error::AgboardError;
use agent_board::server::{ServeConfig, run_until};
use serde_json::Value;

static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Run `f` with `AGBOARD_HOME` set to `home`. Environment access is serialized.
pub fn with_home<T>(home: &Path, f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // SAFETY: access to the environment is serialized by ENV_LOCK.
    unsafe { std::env::set_var("AGBOARD_HOME", home) };
    let result = f();
    // SAFETY: as above.
    unsafe { std::env::remove_var("AGBOARD_HOME") };
    result
}

/// A valid 1x1 PNG.
pub fn png() -> Vec<u8> {
    vec![
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240,
        31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]
}

/// A TASK.md body that the file store accepts.
pub const BODY: &str = "## 作業内容\n\nDetails\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Done\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n";

/// Run the `agboard` binary in `home` with no terminal on standard input.
/// Returns the exit code, standard output, and standard error.
pub fn agboard(home: &Path, args: &[&str]) -> (i32, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .current_dir(home)
        .args(folder_args(home, args))
        .stdin(std::process::Stdio::null())
        .output()
        .unwrap();
    (
        output.status.code().unwrap(),
        String::from_utf8(output.stdout).unwrap(),
        String::from_utf8(output.stderr).unwrap(),
    )
}

/// Run a command that must succeed and parse its JSON output.
pub fn json_ok(home: &Path, args: &[&str]) -> Value {
    let (code, out, err) = agboard(home, args);
    assert_eq!(code, 0, "{args:?} failed: {err}");
    serde_json::from_str(&out).unwrap_or_else(|_| panic!("not JSON: {out}"))
}

/// Run a command that must fail and return its JSON error code.
pub fn json_error(home: &Path, args: &[&str]) -> (i32, String) {
    let (code, _out, err) = agboard(home, &[&["--json"], args].concat());
    assert_ne!(code, 0, "{args:?} unexpectedly succeeded");
    let value: Value =
        serde_json::from_str(&err).unwrap_or_else(|_| panic!("stderr is not JSON: {err}"));
    (code, value["error"]["code"].as_str().unwrap().to_string())
}

/// A project named "Demo" with one card (#1, AI, Doing, idle).
pub fn demo_project(home: &Path) {
    let (code, _, err) = agboard(home, &["project", "create", "Demo"]);
    assert_eq!(code, 0, "{err}");
    let (code, _, err) = agboard(
        home,
        &[
            "--project",
            "Demo",
            "add",
            "Implement sharing",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let (code, _, err) = agboard(
        home,
        &[
            "--project",
            "Demo",
            "mv",
            "1",
            "doing",
            "--actor",
            "ai",
            "--reason",
            "Start.",
        ],
    );
    assert_eq!(code, 0, "{err}");
}

pub struct Reply {
    pub status: u16,
    pub body: String,
    pub bytes: Vec<u8>,
    pub headers: Vec<(String, String)>,
}

impl Reply {
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or_else(|_| panic!("not JSON: {:?}", self.body))
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub fn code(&self) -> String {
        self.json()["error"]["code"].as_str().unwrap().to_string()
    }
}

/// A running `agboard serve` on port 0, stopped on drop.
pub struct Running {
    pub addr: SocketAddr,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    handle: Option<JoinHandle<Result<(), AgboardError>>>,
}

impl Running {
    pub fn start(home: &Path) -> Running {
        with_home(home, || {
            let (ready_tx, ready_rx) = mpsc::channel();
            let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
            let handle = std::thread::spawn(move || {
                run_until(
                    ServeConfig { port: 0 },
                    async move {
                        let _ = stop_rx.await;
                    },
                    move |addr| {
                        let _ = ready_tx.send(addr);
                    },
                )
            });
            match ready_rx.recv_timeout(Duration::from_secs(10)) {
                Ok(addr) => Running {
                    addr,
                    stop: Some(stop_tx),
                    handle: Some(handle),
                },
                Err(_) => panic!("server did not start: {:?}", handle.join()),
            }
        })
    }

    pub fn port(&self) -> u16 {
        self.addr.port()
    }

    /// The write token the board page carries.
    pub fn token(&self) -> String {
        let page = self.get("/").body;
        let marker = "name=\"agboard-token\" content=\"";
        let start = page.find(marker).expect("token meta tag") + marker.len();
        page[start..start + 64].to_string()
    }

    /// The headers the board page sends with a write.
    pub fn page_headers(&self, token: &str) -> Vec<(String, String)> {
        vec![
            ("Origin".into(), format!("http://127.0.0.1:{}", self.port())),
            ("Sec-Fetch-Site".into(), "same-origin".into()),
            ("X-Agboard-Token".into(), token.into()),
        ]
    }

    pub fn get(&self, path: &str) -> Reply {
        self.request("GET", path, None, &[], None)
    }

    /// A JSON write sent the way the board page sends it.
    pub fn write(&self, method: &str, path: &str, body: Option<&str>) -> Reply {
        let headers = self.page_headers(&self.token());
        self.request(method, path, body, &headers, Some("application/json"))
    }

    /// A multipart write sent the way the board page sends it.
    pub fn write_multipart(
        &self,
        method: &str,
        path: &str,
        body: Vec<u8>,
        boundary: &str,
    ) -> Reply {
        let headers = self.page_headers(&self.token());
        let content_type = format!("multipart/form-data; boundary={boundary}");
        self.request_bytes(method, path, body, &headers, Some(&content_type))
    }

    pub fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        headers: &[(String, String)],
        content_type: Option<&str>,
    ) -> Reply {
        self.request_bytes(
            method,
            path,
            body.unwrap_or("").as_bytes().to_vec(),
            headers,
            content_type,
        )
    }

    pub fn request_bytes(
        &self,
        method: &str,
        path: &str,
        body: Vec<u8>,
        headers: &[(String, String)],
        content_type: Option<&str>,
    ) -> Reply {
        let mut builder = ureq::http::Request::builder()
            .method(method)
            .uri(format!("http://{}{path}", self.addr));
        if let Some(content_type) = content_type {
            builder = builder.header("Content-Type", content_type);
        }
        for (name, value) in headers {
            builder = builder.header(name.as_str(), value.as_str());
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(15)))
            .build()
            .into();
        let request = builder.body(body).unwrap();
        // A refused write is answered before the body is read, so the client
        // can see a reset while it is still sending. Ask again in that case.
        let mut attempts = 0;
        let mut response = loop {
            match agent.run(request.clone()) {
                Ok(response) => break response,
                Err(ureq::Error::Io(error))
                    if attempts < 4
                        && matches!(
                            error.kind(),
                            std::io::ErrorKind::InvalidInput
                                | std::io::ErrorKind::BrokenPipe
                                | std::io::ErrorKind::ConnectionReset
                        ) =>
                {
                    attempts += 1;
                }
                Err(error) => panic!("{method} {path}: {error:?}"),
            }
        };
        let headers = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
            .collect();
        let bytes = response.body_mut().read_to_vec().unwrap_or_default();
        Reply {
            status: response.status().as_u16(),
            headers,
            body: String::from_utf8_lossy(&bytes).into_owned(),
            bytes,
        }
    }

    /// Stop the server and wait for it.
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// A multipart body with text fields and file parts. Each file is `(field, filename, bytes)`.
pub fn multipart(
    boundary: &str,
    fields: &[(&str, &str)],
    files: &[(&str, &str, &[u8])],
) -> Vec<u8> {
    let mut out = Vec::new();
    for (name, value) in fields {
        out.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    for (name, filename, bytes) in files {
        out.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        out.extend_from_slice(bytes);
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    out
}

/// A decision request as the `state ... pending --request-json` argument: a question and two choices.
pub fn decision_json(question: &str) -> String {
    serde_json::json!({
        "question": question,
        "choices": [
            {"id": "a", "label": "Plan A"},
            {"id": "b", "label": "Plan B"}
        ]
    })
    .to_string()
}

/// `project create` binds the folder it runs in, and one folder belongs to one
/// project. Every create in a test therefore gets a folder of its own under
/// the test's data area, unless the arguments name one.
fn folder_args(home: &std::path::Path, args: &[&str]) -> Vec<String> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let mut out: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    if let Some(at) = args.windows(2).position(|w| w == ["project", "create"]) {
        let name = at + 2;
        if args.get(name).is_some_and(|n| !n.starts_with('-')) && !args.contains(&"--folder") {
            let dir = home
                .join("folders")
                .join(NEXT.fetch_add(1, Ordering::Relaxed).to_string());
            std::fs::create_dir_all(&dir).unwrap();
            out.splice(
                name + 1..name + 1,
                ["--folder".to_string(), dir.display().to_string()],
            );
        }
    }
    out
}
