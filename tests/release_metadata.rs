//! Focused tests for the release metadata: the package version and license,
//! the tag check, the notices generator, and the archive verifier. Every case
//! works on repository files or on a temporary directory; nothing touches the
//! real agent configuration, the real data directory, or the network.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const ROOT: &str = env!("CARGO_MANIFEST_DIR");

fn root_file(name: &str) -> PathBuf {
    Path::new(ROOT).join(name)
}

fn read(name: &str) -> String {
    fs::read_to_string(root_file(name)).unwrap_or_else(|e| panic!("cannot read {name}: {e}"))
}

fn python(script: &str, args: &[&str]) -> Output {
    Command::new("python3")
        .arg("-I")
        .arg(root_file(script))
        .args(args)
        .env("TZ", "UTC")
        .output()
        .expect("python3 runs")
}

fn text(out: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
}

/// A fixture repository root holding only a Cargo.toml and a Cargo.lock.
fn fixture_root(manifest_version: &str, lock_version: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("Cargo.toml"),
        format!("[package]\nname = \"agent-board\"\nversion = \"{manifest_version}\"\n"),
    )
    .unwrap();
    fs::write(
        dir.path().join("Cargo.lock"),
        format!(
            "version = 4\n\n[[package]]\nname = \"agent-board\"\nversion = \"{lock_version}\"\n"
        ),
    )
    .unwrap();
    dir
}

#[test]
fn package_metadata_is_mit_and_the_lockfile_names_the_same_version() {
    let version = env!("CARGO_PKG_VERSION");
    let manifest = read("Cargo.toml");
    assert!(
        manifest.contains(&format!("version = \"{version}\"")),
        "{manifest}"
    );
    assert!(manifest.contains("license = \"MIT\""), "{manifest}");
    let lock = read("Cargo.lock");
    assert!(
        lock.contains(&format!("name = \"agent-board\"\nversion = \"{version}\"")),
        "the lockfile names another version"
    );
}

/// The archive name the verifier expects for this build and an Apple Silicon Mac.
fn arm_archive_name() -> String {
    format!(
        "agboard-{}-aarch64-apple-darwin.tar.gz",
        env!("CARGO_PKG_VERSION")
    )
}

#[test]
fn license_file_holds_the_standard_mit_text() {
    let license = read("LICENSE");
    assert!(license.starts_with("MIT License\n\nCopyright (c) "));
    for phrase in [
        "Permission is hereby granted, free of charge",
        "The above copyright notice and this permission notice shall be included in all",
        "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND",
    ] {
        assert!(license.contains(phrase), "missing: {phrase}");
    }
}

#[test]
fn check_version_accepts_the_matching_tag() {
    let version = env!("CARGO_PKG_VERSION");
    let out = python(
        "scripts/release/check-version.py",
        &["--tag", &format!("v{version}")],
    );
    assert!(out.status.success(), "{}", text(&out));
    assert!(text(&out).contains(version));
}

#[test]
fn check_version_rejects_a_mismatched_tag() {
    let version = env!("CARGO_PKG_VERSION");
    for tag in [
        "v0.0.1".to_string(),
        version.to_string(),
        "v1".to_string(),
        format!("v{version}-rc1"),
    ] {
        let out = python("scripts/release/check-version.py", &["--tag", &tag]);
        assert_eq!(out.status.code(), Some(1), "tag {tag}: {}", text(&out));
    }
}

#[test]
fn check_version_rejects_a_manifest_and_lockfile_that_disagree() {
    let fixture = fixture_root("1.0.0", "0.9.0");
    let root = fixture.path().to_str().unwrap();
    let out = python(
        "scripts/release/check-version.py",
        &["--tag", "v1.0.0", "--root", root],
    );
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
    assert!(text(&out).contains("Cargo.lock"), "{}", text(&out));
}

#[test]
fn check_version_rejects_a_fixture_tag_that_differs_from_the_manifest() {
    let fixture = fixture_root("1.2.3", "1.2.3");
    let root = fixture.path().to_str().unwrap();
    let ok = python(
        "scripts/release/check-version.py",
        &["--tag", "v1.2.3", "--root", root],
    );
    assert!(ok.status.success(), "{}", text(&ok));
    let bad = python(
        "scripts/release/check-version.py",
        &["--tag", "v1.0.0", "--root", root],
    );
    assert_eq!(bad.status.code(), Some(1), "{}", text(&bad));
}

/// Components for the notices fixture: a plain MIT crate, a crate with an AND
/// condition and a header-derived notice, and an MPL crate that needs a source
/// pointer.
fn notices_fixture(dir: &Path) -> PathBuf {
    let mit = dir.join("mit.txt");
    fs::write(
        &mit,
        "MIT License\n\nCopyright (c) 2020 Plain Author\n\nPermission body.\n",
    )
    .unwrap();
    let apache = dir.join("apache.txt");
    fs::write(&apache, "Apache License text body\n").unwrap();
    let header = dir.join("header.txt");
    fs::write(
        &header,
        "Copyright 2014 Header Author. All rights reserved.\n",
    )
    .unwrap();
    let mpl = dir.join("mpl.txt");
    fs::write(&mpl, "Mozilla Public License Version 2.0 body\n").unwrap();
    let fixture = serde_json::json!([
        {"name": "zeta-mpl", "version": "0.2.0", "distribution": ["macOS arm64", "macOS x86_64"],
         "license": "MPL-2.0", "upstream": "https://example.invalid/zeta",
         "source": {"url": "https://static.crates.io/crates/zeta-mpl/zeta-mpl-0.2.0.crate",
                    "checksum": "abc123", "patches": "None", "modifications": "None",
                    "build": "n/a"},
         "texts": [mpl]},
        {"name": "alpha-mit", "version": "1.0.0", "distribution": ["macOS arm64", "macOS x86_64"],
         "license": "MIT", "upstream": "https://example.invalid/alpha", "texts": [mit]},
        {"name": "beta-and", "version": "2.0.0", "distribution": ["macOS arm64"],
         "license": "Apache-2.0 AND ISC", "upstream": "https://example.invalid/beta",
         "texts": [apache, header]}
    ]);
    let path = dir.join("components.json");
    fs::write(&path, fixture.to_string()).unwrap();
    path
}

fn render(components: &Path) -> Output {
    python(
        "scripts/release/generate-notices.py",
        &["--components", components.to_str().unwrap(), "--stdout"],
    )
}

#[test]
fn notices_keep_plain_and_composite_licenses_headers_and_sources() {
    let dir = tempfile::tempdir().unwrap();
    let out = render(&notices_fixture(dir.path()));
    assert!(out.status.success(), "{}", text(&out));
    let notices = String::from_utf8(out.stdout).unwrap();
    assert!(notices.starts_with("Agent Board - Third-Party Notices\n"));
    assert!(notices.contains("COMPONENT INDEX"));
    assert!(notices.contains("Copyright (c) 2020 Plain Author"));
    assert!(notices.contains("Applicable license: Apache-2.0 AND ISC"));
    assert!(notices.contains("Copyright 2014 Header Author. All rights reserved."));
    assert!(notices.contains("SOURCE AVAILABILITY"));
    assert!(notices.contains("zeta-mpl-0.2.0.crate"));
    assert!(notices.contains("Checksum: abc123"));
    assert!(notices.contains("Mozilla Public License Version 2.0 body"));
    // Components are sorted by name, so the order does not follow the input.
    let alpha = notices.find("Component: alpha-mit").unwrap();
    let beta = notices.find("Component: beta-and").unwrap();
    let zeta = notices.find("Component: zeta-mpl").unwrap();
    assert!(alpha < beta && beta < zeta);
    assert!(!notices.contains(dir.path().to_str().unwrap()));
    assert!(!notices.contains("TODO"));
}

#[test]
fn notices_are_identical_for_identical_input() {
    let dir = tempfile::tempdir().unwrap();
    let components = notices_fixture(dir.path());
    let first = render(&components);
    let second = render(&components);
    assert!(first.status.success(), "{}", text(&first));
    assert_eq!(first.stdout, second.stdout);
}

#[test]
fn notices_generation_fails_when_a_license_text_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let fixture = serde_json::json!([
        {"name": "no-text", "version": "1.0.0", "distribution": ["macOS arm64"],
         "license": "MIT", "upstream": "https://example.invalid/x", "texts": []}
    ]);
    let path = dir.path().join("components.json");
    fs::write(&path, fixture.to_string()).unwrap();
    let out = render(&path);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
    assert!(text(&out).contains("no-text"), "{}", text(&out));
}

#[test]
fn committed_notices_are_complete() {
    let notices = read("THIRD_PARTY_NOTICES.txt");
    assert!(notices.starts_with("Agent Board - Third-Party Notices\n"));
    for section in [
        "COMPONENT INDEX",
        "COMPONENT NOTICES",
        "LICENSE TEXTS",
        "SOURCE AVAILABILITY",
    ] {
        assert!(notices.contains(section), "missing section {section}");
    }
    assert!(
        notices.contains("option-ext"),
        "the MPL crate is not listed"
    );
    assert!(
        notices.contains("elkjs"),
        "the EPL web component is not listed"
    );
    assert!(!notices.contains("<component>") && !notices.contains("TODO"));
    assert!(!notices.contains("/Users/") && !notices.contains("/home/"));
}

fn script(name: &str) -> PathBuf {
    root_file(&format!("scripts/release/{name}"))
}

/// Builds an archive of `files` (name, content) named like a release archive.
fn archive(dir: &Path, name: &str, files: &[(&str, &[u8])]) -> PathBuf {
    let stage = dir.join("stage");
    fs::create_dir_all(&stage).unwrap();
    for (file, content) in files {
        fs::write(stage.join(file), content).unwrap();
        if *file == "agboard" {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(stage.join(file), fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    let names: Vec<&str> = files.iter().map(|(file, _)| *file).collect();
    let path = dir.join(name);
    let status = Command::new("tar")
        .arg("-czf")
        .arg(&path)
        .arg("-C")
        .arg(&stage)
        .args(&names)
        .status()
        .unwrap();
    assert!(status.success());
    path
}

fn verify(archive: &Path, target: &str) -> Output {
    Command::new("bash")
        .arg(script("verify-artifact.sh"))
        .arg(archive)
        .arg(target)
        .env("TZ", "UTC")
        .output()
        .expect("bash runs")
}

#[test]
fn verifier_accepts_the_three_files_in_a_case_insensitive_locale() {
    // A UTF-8 locale, as on the GitHub runners, sorts `agboard` before
    // `LICENSE`; the check must not depend on that order.
    let dir = tempfile::tempdir().unwrap();
    let license = read("LICENSE");
    let notices = read("THIRD_PARTY_NOTICES.txt");
    let path = archive(
        dir.path(),
        &arm_archive_name(),
        &[
            ("agboard", b"binary"),
            ("LICENSE", license.as_bytes()),
            ("THIRD_PARTY_NOTICES.txt", notices.as_bytes()),
        ],
    );
    let out = Command::new("bash")
        .arg(script("verify-artifact.sh"))
        .arg(&path)
        .arg("aarch64-apple-darwin")
        .env("TZ", "UTC")
        .env("LC_ALL", "en_US.UTF-8")
        .output()
        .expect("bash runs");
    // The fake binary fails a later check; the file list must pass.
    assert!(!text(&out).contains("unexpected files"), "{}", text(&out));
}

#[test]
fn verifier_rejects_an_archive_without_the_license() {
    let dir = tempfile::tempdir().unwrap();
    let notices = read("THIRD_PARTY_NOTICES.txt");
    let path = archive(
        dir.path(),
        &arm_archive_name(),
        &[
            ("agboard", b"binary"),
            ("THIRD_PARTY_NOTICES.txt", notices.as_bytes()),
        ],
    );
    let out = verify(&path, "aarch64-apple-darwin");
    assert!(!out.status.success());
    assert!(text(&out).contains("LICENSE"), "{}", text(&out));
}

#[test]
fn verifier_rejects_an_archive_without_the_notices() {
    let dir = tempfile::tempdir().unwrap();
    let license = read("LICENSE");
    let path = archive(
        dir.path(),
        &arm_archive_name(),
        &[("agboard", b"binary"), ("LICENSE", license.as_bytes())],
    );
    let out = verify(&path, "aarch64-apple-darwin");
    assert!(!out.status.success());
    assert!(
        text(&out).contains("THIRD_PARTY_NOTICES.txt"),
        "{}",
        text(&out)
    );
}

#[test]
fn verifier_rejects_a_license_that_differs_from_the_repository_file() {
    let dir = tempfile::tempdir().unwrap();
    let notices = read("THIRD_PARTY_NOTICES.txt");
    let path = archive(
        dir.path(),
        &arm_archive_name(),
        &[
            ("agboard", b"binary"),
            ("LICENSE", b"changed"),
            ("THIRD_PARTY_NOTICES.txt", notices.as_bytes()),
        ],
    );
    let out = verify(&path, "aarch64-apple-darwin");
    assert!(!out.status.success());
    assert!(text(&out).contains("LICENSE"), "{}", text(&out));
}

#[test]
fn verifier_rejects_an_archive_named_for_another_version_or_target() {
    let dir = tempfile::tempdir().unwrap();
    let license = read("LICENSE");
    let notices = read("THIRD_PARTY_NOTICES.txt");
    let files: [(&str, &[u8]); 3] = [
        ("agboard", b"binary"),
        ("LICENSE", license.as_bytes()),
        ("THIRD_PARTY_NOTICES.txt", notices.as_bytes()),
    ];
    let wrong_version = archive(
        dir.path(),
        "agboard-0.9.0-aarch64-apple-darwin.tar.gz",
        &files,
    );
    let out = verify(&wrong_version, "aarch64-apple-darwin");
    assert!(!out.status.success(), "{}", text(&out));
    let wrong_target = verify(&wrong_version, "x86_64-apple-darwin");
    assert!(!wrong_target.status.success(), "{}", text(&wrong_target));
}

#[test]
fn verifier_rejects_a_binary_that_is_not_a_macho_for_the_target() {
    if !cfg!(target_os = "macos") {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let license = read("LICENSE");
    let notices = read("THIRD_PARTY_NOTICES.txt");
    let path = archive(
        dir.path(),
        &arm_archive_name(),
        &[
            ("agboard", b"#!/bin/sh\necho agboard 1.0.0\n"),
            ("LICENSE", license.as_bytes()),
            ("THIRD_PARTY_NOTICES.txt", notices.as_bytes()),
        ],
    );
    let out = verify(&path, "aarch64-apple-darwin");
    assert!(!out.status.success());
    assert!(
        text(&out).to_lowercase().contains("mach-o"),
        "{}",
        text(&out)
    );
}

#[test]
fn workflow_builds_both_cpus_natively_and_keeps_release_writes_out() {
    let workflow = read(".github/workflows/release.yml");
    for needle in [
        "aarch64-apple-darwin",
        "x86_64-apple-darwin",
        "macos-15-intel",
        "MACOSX_DEPLOYMENT_TARGET: \"15.0\"",
        "cargo build --release --locked",
        "scripts/release/check-version.py",
        "scripts/release/verify-artifact.sh",
        "workflow_dispatch",
    ] {
        assert!(workflow.contains(needle), "release.yml lacks: {needle}");
    }
    assert!(
        workflow.contains("macos-15"),
        "the arm64 runner label is missing"
    );
    // The default token is read-only. Which jobs may hold secrets or write
    // contents is checked per job in tests/release_signing.rs.
    assert!(workflow.contains("contents: read"));
}

#[test]
fn check_version_requires_both_cpu_archives_and_nothing_else() {
    let fixture = fixture_root("1.0.0", "1.0.0");
    let root = fixture.path().to_str().unwrap();
    let assets = tempfile::tempdir().unwrap();
    let dir = assets.path().to_str().unwrap();
    let run = || {
        python(
            "scripts/release/check-version.py",
            &["--tag", "v1.0.0", "--root", root, "--assets", dir],
        )
    };
    fs::write(
        assets
            .path()
            .join("agboard-1.0.0-aarch64-apple-darwin.tar.gz"),
        "a",
    )
    .unwrap();
    let one_cpu = run();
    assert_eq!(one_cpu.status.code(), Some(1), "{}", text(&one_cpu));
    assert!(
        text(&one_cpu).contains("x86_64-apple-darwin"),
        "{}",
        text(&one_cpu)
    );
    fs::write(
        assets
            .path()
            .join("agboard-1.0.0-x86_64-apple-darwin.tar.gz"),
        "b",
    )
    .unwrap();
    assert!(run().status.success());
    fs::write(
        assets
            .path()
            .join("agboard-0.9.0-x86_64-apple-darwin.tar.gz"),
        "c",
    )
    .unwrap();
    assert_eq!(run().status.code(), Some(1));
}
