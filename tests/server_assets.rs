//! Integration tests for the embedded scripts and stylesheets: the tables
//! `build.rs` generates from `web/dist/`, and `GET /assets/{name}`.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

use agent_board::error::AgboardError;
use agent_board::server::web_assets::{APP_ASSETS, MONITOR_ASSETS};
use agent_board::server::{ServeConfig, run_until};

const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// Compile the real `build.rs` and run it the way Cargo would, with
/// `CARGO_MANIFEST_DIR` at `manifest_dir` and a fresh `OUT_DIR`. Returns the
/// run's output and the generated `web_assets.rs`, if it was written.
fn run_build_script(manifest_dir: &Path) -> (std::process::Output, Option<String>) {
    let scratch = tempfile::tempdir().unwrap();
    let exe = scratch.path().join("build_script");
    let out_dir = scratch.path().join("out");
    std::fs::create_dir_all(&out_dir).unwrap();
    let compiled = Command::new("rustc")
        .args(["--edition", "2024", "--crate-name", "build_script", "-o"])
        .arg(&exe)
        .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/build.rs"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "build.rs does not compile: {}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let output = Command::new(&exe)
        .env("CARGO_MANIFEST_DIR", manifest_dir)
        .env("OUT_DIR", &out_dir)
        .output()
        .unwrap();
    let table = std::fs::read_to_string(out_dir.join("web_assets.rs")).ok();
    (output, table)
}

fn write(root: &Path, rel: &str, bytes: &[u8]) {
    let path = root.join("web/dist").join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

/// A fake crate root with a complete build: the pages load `app-A1.js`,
/// `app-A2.css`, `monitor-M1.js` and `monitor-M2.css`, each with its `.gz`,
/// plus `extra` files (also given as `(path, bytes)`).
fn fake_build(extra: &[(&str, &[u8])]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "index.html",
        br#"<script src="/assets/app-A1.js"></script><link href="/assets/app-A2.css">"#,
    );
    write(
        root,
        "monitor/index.html",
        br#"<script src="/monitor/assets/monitor/monitor-M1.js"></script><link href="/monitor/assets/monitor/monitor-M2.css">"#,
    );
    for rel in ["logo.png", "logo-white.png"] {
        write(root, rel, b"x");
    }
    for name in [
        "assets/app-A1.js",
        "assets/app-A2.css",
        "monitor/monitor-M1.js",
        "monitor/monitor-M2.css",
        "sandbox/sandbox-S1.js",
    ] {
        write(root, name, name.as_bytes());
        write(root, &format!("{name}.gz"), name.as_bytes());
    }
    for (rel, bytes) in extra {
        write(root, rel, bytes);
    }
    dir
}

fn failure(dir: &Path) -> String {
    let (output, _) = run_build_script(dir);
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    assert!(stderr.contains("pnpm --dir web build"), "{stderr}");
    stderr
}

#[test]
fn the_build_rejects_missing_isolated_assets_with_an_actionable_message() {
    let dir = tempfile::tempdir().unwrap();
    for rel in ["index.html", "logo.png", "logo-white.png"] {
        write(dir.path(), rel, b"x");
    }
    let stderr = failure(dir.path());
    assert!(
        stderr.contains("the monitor web assets are not built"),
        "{stderr}"
    );
}

#[test]
fn the_build_rejects_a_missing_sandbox_script() {
    let dir = fake_build(&[]);
    std::fs::remove_file(dir.path().join("web/dist/sandbox/sandbox-S1.js.gz")).unwrap();
    std::fs::remove_file(dir.path().join("web/dist/sandbox/sandbox-S1.js")).unwrap();
    let stderr = failure(dir.path());
    assert!(stderr.contains("sandbox web assets"), "{stderr}");
}

#[test]
fn the_build_rejects_a_page_that_loads_a_file_that_is_not_built() {
    let dir = fake_build(&[]);
    std::fs::remove_file(dir.path().join("web/dist/assets/app-A2.css")).unwrap();
    let stderr = failure(dir.path());
    assert!(stderr.contains("app-A2.css"), "{stderr}");
}

#[test]
fn the_build_rejects_a_file_without_its_gzip_copy() {
    let dir = fake_build(&[]);
    std::fs::remove_file(dir.path().join("web/dist/monitor/monitor-M1.js.gz")).unwrap();
    let stderr = failure(dir.path());
    assert!(stderr.contains("monitor-M1.js.gz is missing"), "{stderr}");
}

#[test]
fn the_tables_list_entries_and_chunks_and_nothing_else() {
    let dir = fake_build(&[
        ("assets/chunk-spec-AAAA.js", b"spec"),
        ("assets/chunk-spec-AAAA.js.gz", b"spec"),
        ("assets/other.js", b"other"),
        ("assets/chunk-map-BBBB.js.map", b"map"),
        ("monitor/app-C1.js", b"board"),
        ("monitor/app-C1.js.gz", b"board"),
    ]);
    let (output, table) = run_build_script(dir.path());
    assert!(output.status.success(), "{output:?}");
    let table = table.expect("the build script writes web_assets.rs");
    for name in [
        "app-A1.js",
        "app-A2.css",
        "chunk-spec-AAAA.js",
        "monitor-M1.js",
    ] {
        assert!(table.contains(&format!("name: \"{name}\"")), "{table}");
    }
    for name in ["other.js", "chunk-map-BBBB.js.map", "app-C1.js"] {
        assert!(!table.contains(&format!("name: \"{name}\"")), "{table}");
    }
    assert!(
        table.contains("mime: \"text/css; charset=utf-8\""),
        "{table}"
    );
}

#[test]
fn a_file_both_pages_contain_is_embedded_once() {
    let dir = fake_build(&[
        ("assets/chunk-same-SSSS.js", b"same"),
        ("assets/chunk-same-SSSS.js.gz", b"same gzip"),
        ("monitor/chunk-same-SSSS.js", b"same"),
        ("monitor/chunk-same-SSSS.js.gz", b"same gzip"),
    ]);
    let (output, table) = run_build_script(dir.path());
    assert!(output.status.success(), "{output:?}");
    let table = table.unwrap();
    // Four entry files, the sandbox script and one shared chunk.
    assert_eq!(table.matches("include_bytes!").count(), 6, "{table}");
    assert_eq!(table.matches("chunk-same-SSSS.js\"").count(), 2, "{table}");
}

#[test]
fn the_build_id_follows_the_page() {
    let build_id = |html: &[u8]| {
        let dir = fake_build(&[("index.html", html)]);
        let (output, table) = run_build_script(dir.path());
        assert!(output.status.success(), "{output:?}");
        table
            .unwrap()
            .lines()
            .find(|line| line.starts_with("pub const APP_BUILD_ID"))
            .unwrap()
            .to_owned()
    };
    let one = build_id(br#"<script src="/assets/app-A1.js"></script>"#);
    let same = build_id(br#"<script src="/assets/app-A1.js"></script>"#);
    let other = build_id(br#"<link href="/assets/app-A2.css"><script src="/assets/app-A1.js">"#);
    assert_eq!(one, same);
    assert_ne!(one, other);
}

// ---------------------------------------------------------------- harness

// AGBOARD_HOME is process-global. It is only needed while a server starts (the
// server captures its paths then), so the lock is released once it is ready.
static ENV_LOCK: Mutex<()> = Mutex::new(());

struct Running {
    addr: SocketAddr,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    handle: Option<JoinHandle<Result<(), AgboardError>>>,
}

impl Running {
    fn start(home: &Path) -> Running {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // SAFETY: access to the environment is serialized by ENV_LOCK.
        unsafe { std::env::set_var("AGBOARD_HOME", home) };
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
        let addr = ready_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("the server becomes ready");
        // SAFETY: as above.
        unsafe { std::env::remove_var("AGBOARD_HOME") };
        Running {
            addr,
            stop: Some(stop_tx),
            handle: Some(handle),
        }
    }

    /// Send a raw path, without any client-side normalization of `..`.
    fn get(&self, path: &str) -> Reply {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(5)))
            .build()
            .into();
        let request = ureq::http::Request::builder()
            .method("GET")
            .uri(format!("http://{}{path}", self.addr))
            .body(())
            .unwrap();
        let mut response = agent.run(request).unwrap();
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .map(|v| v.to_str().unwrap().to_string())
        };
        let content_type = header("content-type");
        let cache_control = header("cache-control");
        let status = response.status().as_u16();
        let body = response.body_mut().read_to_vec().unwrap_or_default();
        Reply {
            status,
            content_type,
            cache_control,
            body,
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

struct Reply {
    status: u16,
    content_type: Option<String>,
    cache_control: Option<String>,
    body: Vec<u8>,
}

/// The board's files in the real `web/dist/assets`, as embedded.
fn real_names() -> Vec<&'static str> {
    APP_ASSETS.iter().map(|asset| asset.name).collect()
}

/// A raw request with `Accept-Encoding: gzip`: the status line, the headers
/// and the body exactly as sent.
fn raw_gzip_get(addr: SocketAddr, path: &str) -> (String, Vec<u8>) {
    let mut stream = TcpStream::connect(addr).unwrap();
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAccept-Encoding: gzip\r\nConnection: close\r\n\r\n",
        addr.port()
    )
    .unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap();
    let head = String::from_utf8_lossy(&response[..split]).to_lowercase();
    (head, response[split + 4..].to_vec())
}

// ---------------------------------------------------------------- routes

#[test]
fn every_file_in_the_build_is_served_by_name_as_immutable() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("web/dist/assets");
    for name in real_names() {
        let reply = server.get(&format!("/assets/{name}"));
        assert_eq!(reply.status, 200, "{name}");
        let mime = if name.ends_with(".css") {
            "text/css; charset=utf-8"
        } else {
            "text/javascript; charset=utf-8"
        };
        assert_eq!(reply.content_type.as_deref(), Some(mime), "{name}");
        assert_eq!(reply.cache_control.as_deref(), Some(IMMUTABLE), "{name}");
        assert_eq!(
            reply.body,
            std::fs::read(dist.join(name)).unwrap(),
            "{name}"
        );
    }
}

#[test]
fn a_browser_that_accepts_gzip_gets_the_compressed_bytes() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("web/dist/assets");
    let name = APP_ASSETS
        .iter()
        .find(|asset| asset.name.starts_with("app-") && asset.name.ends_with(".js"))
        .unwrap()
        .name;
    let (head, body) = raw_gzip_get(server.addr, &format!("/assets/{name}"));
    assert!(head.starts_with("http/1.1 200"), "{head}");
    assert!(head.contains("content-encoding: gzip"), "{head}");
    assert!(head.contains("vary: accept-encoding"), "{head}");
    assert!(
        head.contains(&format!("cache-control: {IMMUTABLE}")),
        "{head}"
    );
    assert_eq!(
        body,
        std::fs::read(dist.join(format!("{name}.gz"))).unwrap()
    );
}

#[test]
fn the_monitor_reuses_the_boards_diagram_chunks() {
    let shared: Vec<_> = MONITOR_ASSETS
        .iter()
        .filter(|asset| asset.name.starts_with("chunk-mermaid.core-"))
        .collect();
    assert_eq!(shared.len(), 1);
    assert!(APP_ASSETS.iter().any(|asset| asset.name == shared[0].name));
}

#[test]
fn names_that_are_not_in_the_table_are_404() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    for path in [
        "/assets/app.js",
        "/assets/app.css",
        "/assets/app-nope.js",
        "/assets/app-.js.map",
        "/assets/other.js",
        "/assets/app.js.map",
        "/assets/index.html",
    ] {
        assert_eq!(server.get(path).status, 404, "{path}");
    }
    let first = real_names()[0];
    assert_eq!(server.get(&format!("/assets/{first}.gz")).status, 404);
}

#[test]
fn traversal_and_separators_in_the_name_are_404() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    for path in [
        "/assets/../app.js",
        "/assets/%2e%2e",
        "/assets/%2e%2e%2fapp.js",
        "/assets/..%2fapp.js",
        "/assets/..%2Fapp.js",
        "/assets/app-x.js%2f..%2fapp.js",
    ] {
        assert_eq!(server.get(path).status, 404, "{path}");
    }
}
