//! Integration tests for the on-demand web chunks: the table `build.rs`
//! generates from `web/dist/assets/app-*.js`, and `GET /assets/{name}`.

use std::net::SocketAddr;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

use agent_board::error::AgboardError;
use agent_board::server::{ServeConfig, run_until};

/// Compile the real `build.rs` and run it the way Cargo would, with
/// `CARGO_MANIFEST_DIR` at `manifest_dir` and a fresh `OUT_DIR`. Returns the
/// run's output and the generated `assets_table.rs`, if it was written.
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
    let table = std::fs::read_to_string(out_dir.join("assets_table.rs")).ok();
    (output, table)
}

/// A fake crate root whose `web/dist` holds the required files plus `extra`.
fn fake_manifest(extra: &[&str]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let required = [
        "index.html",
        "assets/app.js",
        "assets/app.css",
        "logo.png",
        "logo-white.png",
        "access/index.html",
        "access/entry.js",
        "monitor/index.html",
        "monitor/monitor.js",
        "monitor/monitor.css",
    ];
    for rel in required.iter().chain(extra) {
        let path = dir.path().join("web/dist").join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }
    dir
}

fn fake_pc_only_manifest() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for rel in [
        "index.html",
        "assets/app.js",
        "assets/app.css",
        "logo.png",
        "logo-white.png",
    ] {
        let path = dir.path().join("web/dist").join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }
    dir
}

#[test]
fn the_build_rejects_missing_isolated_assets_with_an_actionable_message() {
    let dir = fake_pc_only_manifest();
    let (output, _) = run_build_script(dir.path());
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("the access web assets are not built"),
        "{stderr}"
    );
    assert!(stderr.contains("pnpm --dir web build"), "{stderr}");
}

#[test]
fn the_table_lists_the_app_chunks_and_nothing_else() {
    let dir = fake_manifest(&[
        "assets/app-spec-AAAA.js",
        "assets/app-mermaid-BBBB.js",
        "assets/app-x.css",
        "assets/other.js",
    ]);
    let (output, table) = run_build_script(dir.path());
    assert!(output.status.success(), "{:?}", output);
    let table = table.expect("the build script writes assets_table.rs");
    assert!(table.contains("\"app-spec-AAAA.js\""), "{table}");
    assert!(table.contains("\"app-mermaid-BBBB.js\""), "{table}");
    assert!(!table.contains("\"app.js\""), "{table}");
    assert!(!table.contains("app-x.css"), "{table}");
    assert!(!table.contains("other.js"), "{table}");
}

#[test]
fn the_build_passes_with_no_chunks_and_the_table_is_empty() {
    let dir = fake_manifest(&[]);
    let (output, table) = run_build_script(dir.path());
    assert!(output.status.success(), "{:?}", output);
    let table = table.expect("the build script writes assets_table.rs");
    assert!(!table.contains("include_bytes"), "{table}");
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

/// The `app-*.js` files in the real `web/dist/assets`, if the UI was built.
fn real_chunk_names() -> Vec<String> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("web/dist/assets");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("app-") && name.ends_with(".js"))
        .collect()
}

// ---------------------------------------------------------------- routes

#[test]
fn every_chunk_in_the_build_is_served_by_name_as_immutable_javascript() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("web/dist/assets");
    for name in real_chunk_names() {
        let reply = server.get(&format!("/assets/{name}"));
        assert_eq!(reply.status, 200, "{name}");
        assert_eq!(
            reply.content_type.as_deref(),
            Some("text/javascript; charset=utf-8"),
            "{name}"
        );
        assert_eq!(
            reply.cache_control.as_deref(),
            Some("public, max-age=31536000, immutable"),
            "{name}"
        );
        assert_eq!(
            reply.body,
            std::fs::read(dist.join(&name)).unwrap(),
            "{name}"
        );
    }
}

#[test]
fn names_that_are_not_in_the_table_are_404() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    for path in [
        "/assets/app-nope.js",
        "/assets/app-.js.map",
        "/assets/other.js",
        "/assets/app.js.map",
    ] {
        assert_eq!(server.get(path).status, 404, "{path}");
    }
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

#[test]
fn the_existing_app_routes_keep_their_cache_policy() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    let js = server.get("/assets/app.js");
    assert_eq!(js.status, 200);
    assert_eq!(js.cache_control.as_deref(), Some("no-store"));
    let css = server.get("/assets/app.css");
    assert_eq!(css.status, 200);
    assert_eq!(css.cache_control.as_deref(), Some("no-store"));
}
