//! Integration tests for the web server.

use std::path::Path;
use std::process::Command;

/// Compile the real `build.rs` and run it against `manifest_dir`, the way
/// Cargo would: `CARGO_MANIFEST_DIR` points at the crate root.
fn run_build_script(manifest_dir: &Path) -> std::process::Output {
    let scratch = tempfile::tempdir().unwrap();
    let exe = scratch.path().join("build_script");
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
    Command::new(&exe)
        .env("CARGO_MANIFEST_DIR", manifest_dir)
        .output()
        .unwrap()
}

fn fake_manifest(files: &[&str]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for rel in files {
        let path = dir.path().join("web/dist").join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }
    dir
}

#[test]
fn build_script_stops_the_build_without_the_web_assets() {
    let dir = fake_manifest(&[]);
    let out = run_build_script(dir.path());
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Run \"pnpm --dir web build\" first."),
        "{stderr}"
    );
}

#[test]
fn build_script_stops_the_build_when_one_asset_is_missing() {
    let dir = fake_manifest(&["index.html", "assets/app.css"]);
    let out = run_build_script(dir.path());
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("assets/app.js"), "{stderr}");
    assert!(
        stderr.contains("Run \"pnpm --dir web build\" first."),
        "{stderr}"
    );
}

#[test]
fn build_script_passes_and_watches_the_dist_directory_when_built() {
    let dir = fake_manifest(&["index.html", "assets/app.js", "assets/app.css"]);
    let out = run_build_script(dir.path());
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("cargo:rerun-if-changed=web/dist"),
        "{stdout}"
    );
}
