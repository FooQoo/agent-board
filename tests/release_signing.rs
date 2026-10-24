//! Fixture tests for the signing, notarization and release-gate scripts. The
//! real `codesign`, `security`, `xcrun` and `ditto` are replaced by fakes that
//! record their arguments and return fixed results, so these tests check the
//! gate's decisions and exit codes only. They do NOT prove that Developer ID
//! signing or Apple notarization works. Everything runs in temporary
//! directories; no keychain, network, or real HOME is touched.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const ROOT: &str = env!("CARGO_MANIFEST_DIR");
const ID: &str = "io.github.FooQoo.agent-board.agboard";
const TEAM: &str = "TEAM123456";
const T_ARM: &str = "aarch64-apple-darwin";
const T_X86: &str = "x86_64-apple-darwin";
// Obviously fake values; none is a real credential.
const FAKE_P12: &str = "ZmFrZS1wMTI=";
const FAKE_CERT_PW: &str = "fixture-cert-pw-not-real";
const FAKE_APPLE_ID: &str = "fixture@example.invalid";
const FAKE_APP_PW: &str = "fixture-app-pw-not-real";

fn repo(name: &str) -> PathBuf {
    Path::new(ROOT).join(name)
}

fn script(name: &str) -> PathBuf {
    repo(&format!("scripts/release/{name}"))
}

fn text(out: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
}

fn write_exe(path: &Path, body: &str) {
    fs::write(path, format!("#!/bin/bash\n{body}\n")).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

/// A temporary world with fake tools first on PATH.
struct World {
    dir: tempfile::TempDir,
}

impl World {
    fn new() -> World {
        let w = World {
            dir: tempfile::tempdir().unwrap(),
        };
        for d in ["bin", "state", "runner"] {
            fs::create_dir_all(w.dir.path().join(d)).unwrap();
        }
        let bin = w.dir.path().join("bin");
        write_exe(
            &bin.join("security"),
            r#"echo "security $*" >> "$FAKE_LOG"
case "$1" in
  list-keychains)
    if [ "${2:-}" = "-d" ] && [ "${3:-}" = "user" ] && [ "${4:-}" = "-s" ]; then
      shift 4; printf '%s\n' "$@" > "$FAKE_STATE/list"
    else cat "$FAKE_STATE/list" 2>/dev/null || echo '    "/fake/login.keychain-db"'; fi ;;
  find-identity) cat "$FAKE_IDENTITIES" ;;
  import) exit "${FAKE_IMPORT_EXIT:-0}" ;;
  delete-keychain) touch "$FAKE_STATE/deleted" ;;
esac
exit 0"#,
        );
        write_exe(
            &bin.join("codesign"),
            r#"echo "codesign $*" >> "$FAKE_LOG"
case "$1" in
  --force) [ "${FAKE_SIGN_EXIT:-0}" = 0 ] || exit "$FAKE_SIGN_EXIT"; eval "last=\${$#}"; printf SIGNED >> "$last" ;;
  --verify) exit "${FAKE_VERIFY_EXIT:-0}" ;;
  -dv)
    {
      echo "Identifier=${FAKE_IDENT:-io.github.FooQoo.agent-board.agboard}"
      echo "CodeDirectory v=20500 size=1 flags=${FAKE_FLAGS:-0x10000(runtime)} hashes=1 location=embedded"
      echo "Signature=${FAKE_SIGNATURE:-size=9000}"
      echo "Authority=${FAKE_AUTH:-Developer ID Application: Fixture (TEAM123456)}"
      echo "Authority=Developer ID Certification Authority"
      [ -n "${FAKE_NO_TIMESTAMP:-}" ] || echo "Timestamp=Oct 24, 2026 at 12:00:00"
      echo "TeamIdentifier=${FAKE_TEAM:-TEAM123456}"
    } >&2 ;;
  -dr) echo "designated => identifier \"x\" and anchor apple generic and certificate leaf[subject.OU] = ${FAKE_REQ_TEAM:-TEAM123456}${FAKE_REQ_EXTRA:-}" ;;
esac
exit 0"#,
        );
        write_exe(
            &bin.join("xcrun"),
            r#"echo "xcrun $*" >> "$FAKE_LOG"
case "$2" in
  submit|info) printf '%s\n' "${FAKE_NOTARY_JSON:-}"; exit "${FAKE_NOTARY_EXIT:-0}" ;;
  log) eval "last=\${$#}"; echo "{\"issues\":[\"leaked $APPLE_ID and $APPLE_APP_PASSWORD\"]}" > "$last" ;;
esac
exit 0"#,
        );
        // `ditto -c -k <src> <zip>`: the fake only copies, enough to hash.
        write_exe(
            &bin.join("ditto"),
            r#"echo "ditto $*" >> "$FAKE_LOG"; cp "$3" "$4""#,
        );
        fs::write(
            w.path("identities"),
            format!(
                "  1) AAAA1111 \"Developer ID Application: Fixture ({TEAM})\"\n     1 valid identities found\n"
            ),
        )
        .unwrap();
        w
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.path().join(name)
    }

    fn log(&self) -> String {
        fs::read_to_string(self.path("log")).unwrap_or_default()
    }

    fn cmd(&self, script_name: &str, args: &[&str]) -> Command {
        let mut c = Command::new("bash");
        c.arg(script(script_name)).args(args);
        let old = std::env::var("PATH").unwrap_or_default();
        c.env("PATH", format!("{}:{old}", self.path("bin").display()))
            .env("TZ", "UTC")
            .env("FAKE_LOG", self.path("log"))
            .env("FAKE_STATE", self.path("state"))
            .env("FAKE_IDENTITIES", self.path("identities"))
            .env("RUNNER_TEMP", self.path("runner"))
            .env("GITHUB_ENV", self.path("github_env"))
            .env_remove("APPLE_TEAM_ID")
            .env_remove("APPLE_ID")
            .env_remove("APPLE_APP_PASSWORD")
            .env_remove("NOTARY_RESUME_ID");
        c
    }

    fn secrets(&self, c: &mut Command) {
        c.env("MACOS_CERT_P12", FAKE_P12)
            .env("MACOS_CERT_PASSWORD", FAKE_CERT_PW)
            .env("APPLE_TEAM_ID", TEAM);
    }

    fn prepare(&self, with_secrets: bool) -> Output {
        let mut c = self.cmd("sign-macos.sh", &["prepare"]);
        if with_secrets {
            self.secrets(&mut c);
        } else {
            c.env("APPLE_TEAM_ID", TEAM);
        }
        c.output().unwrap()
    }

    fn binary(&self) -> PathBuf {
        let p = self.path("agboard");
        fs::write(&p, b"unsigned-bytes").unwrap();
        p
    }
}

fn assert_no_secrets(output: &str) {
    for secret in [FAKE_P12, FAKE_CERT_PW, FAKE_APPLE_ID, FAKE_APP_PW] {
        assert!(
            !output.contains(secret),
            "a secret value reached the output"
        );
    }
}

// ---- sign-macos.sh -------------------------------------------------------

#[test]
fn prepare_makes_a_job_keychain_resolves_one_identity_and_cleanup_removes_it() {
    let w = World::new();
    let out = w.prepare(true);
    assert_eq!(out.status.code(), Some(0), "{}", text(&out));
    assert_no_secrets(&text(&out));
    let env = fs::read_to_string(w.path("github_env")).unwrap();
    assert!(env.contains(&format!(
        "SIGNING_KEYCHAIN_PATH={}/agboard-signing/agboard-signing.keychain-db",
        w.path("runner").display()
    )));
    assert!(env.contains("SIGNING_IDENTITY=AAAA1111"), "{env}");
    assert_no_secrets(&env);
    let log = w.log();
    assert!(log.contains("security create-keychain"));
    assert!(log.contains("-T /usr/bin/codesign"));
    assert!(!w.path("runner/agboard-signing/cert.p12").exists());

    let mut clean = w.cmd("sign-macos.sh", &["cleanup"]);
    let out = clean.output().unwrap();
    assert_eq!(out.status.code(), Some(0), "{}", text(&out));
    assert!(w.path("state/deleted").exists(), "keychain was not deleted");
    assert!(!w.path("runner/agboard-signing").exists());
    // The original search list came back.
    let list = fs::read_to_string(w.path("state/list")).unwrap();
    assert_eq!(list.trim(), "/fake/login.keychain-db");
    // A second cleanup is harmless.
    assert_eq!(
        w.cmd("sign-macos.sh", &["cleanup"])
            .output()
            .unwrap()
            .status
            .code(),
        Some(0)
    );
}

#[test]
fn prepare_without_the_certificate_secret_stops_with_exit_2_and_makes_no_keychain() {
    let w = World::new();
    let out = w.prepare(false);
    assert_eq!(out.status.code(), Some(2), "{}", text(&out));
    assert!(text(&out).contains("MACOS_CERT_P12"));
    assert!(!w.log().contains("create-keychain"));
    assert!(!w.path("runner/agboard-signing").exists());
}

#[test]
fn prepare_stops_with_exit_3_unless_exactly_one_identity_of_the_team_resolves() {
    let cases = [
        ("no identity", "     0 valid identities found\n".to_string()),
        (
            "another team",
            "  1) AAAA1111 \"Developer ID Application: Other (OTHER99999)\"\n".to_string(),
        ),
        (
            "wrong certificate kind",
            format!("  1) AAAA1111 \"Apple Development: Fixture ({TEAM})\"\n"),
        ),
        (
            "two identities",
            format!(
                "  1) AAAA1111 \"Developer ID Application: A ({TEAM})\"\n  2) BBBB2222 \"Developer ID Application: A ({TEAM})\"\n"
            ),
        ),
    ];
    for (name, identities) in cases {
        let w = World::new();
        fs::write(w.path("identities"), identities).unwrap();
        let out = w.prepare(true);
        assert_eq!(out.status.code(), Some(3), "{name}: {}", text(&out));
        assert!(
            w.path("state/deleted").exists(),
            "{name}: the keychain was left behind"
        );
        assert!(!w.path("runner/agboard-signing").exists(), "{name}");
    }
}

#[test]
fn prepare_stops_when_the_certificate_cannot_be_imported() {
    let w = World::new();
    let mut c = w.cmd("sign-macos.sh", &["prepare"]);
    w.secrets(&mut c);
    let out = c.env("FAKE_IMPORT_EXIT", "1").output().unwrap();
    assert_eq!(out.status.code(), Some(2), "{}", text(&out));
    assert_no_secrets(&text(&out));
    assert!(w.path("state/deleted").exists());
}

#[test]
fn sign_runs_the_exact_codesign_command_with_the_fixed_identifier() {
    let w = World::new();
    let bin = w.binary();
    let out = w
        .cmd("sign-macos.sh", &["sign", bin.to_str().unwrap()])
        .env("SIGNING_KEYCHAIN_PATH", "/kc/job.keychain-db")
        .env("SIGNING_IDENTITY", "AAAA1111")
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "{}", text(&out));
    let log = w.log();
    let expected = format!(
        "codesign --force --options runtime --timestamp --identifier {ID} --keychain /kc/job.keychain-db --sign AAAA1111 {}",
        bin.display()
    );
    assert!(log.contains(&expected), "{log}");
    assert!(log.contains("codesign --verify --strict --verbose=4"));
    assert!(!log.contains("--entitlements"));
}

#[test]
fn sign_fails_when_codesign_fails_or_the_keychain_is_not_prepared() {
    let w = World::new();
    let bin = w.binary();
    let run = |extra: Option<(&str, &str)>, keychain: bool| {
        let mut c = w.cmd("sign-macos.sh", &["sign", bin.to_str().unwrap()]);
        if keychain {
            c.env("SIGNING_KEYCHAIN_PATH", "/kc")
                .env("SIGNING_IDENTITY", "A");
        }
        if let Some((k, v)) = extra {
            c.env(k, v);
        }
        c.output().unwrap().status.code()
    };
    assert_eq!(run(Some(("FAKE_SIGN_EXIT", "1")), true), Some(1));
    assert_eq!(run(Some(("FAKE_VERIFY_EXIT", "1")), true), Some(1));
    assert_eq!(run(None, false), Some(2));
}

// ---- verify-signature.sh -------------------------------------------------

fn verify_sig(w: &World, env: &[(&str, &str)], team: Option<&str>) -> Output {
    let bin = w.binary();
    let mut c = w.cmd(
        "verify-signature.sh",
        &[
            bin.to_str().unwrap(),
            T_ARM,
            "--json",
            w.path("signature.json").to_str().unwrap(),
        ],
    );
    if let Some(t) = team {
        c.env("APPLE_TEAM_ID", t);
    }
    for (k, v) in env {
        c.env(k, v);
    }
    c.output().unwrap()
}

#[test]
fn signature_check_accepts_the_contract_and_writes_public_facts() {
    let w = World::new();
    let out = verify_sig(&w, &[], Some(TEAM));
    assert_eq!(out.status.code(), Some(0), "{}", text(&out));
    let json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(w.path("signature.json")).unwrap()).unwrap();
    assert_eq!(json["identifier"], ID);
    assert_eq!(json["team_id"], TEAM);
    assert_eq!(json["runtime"], true);
    assert_eq!(json["timestamp"], true);
    assert_eq!(json["binary_sha256"].as_str().unwrap().len(), 64);
}

#[test]
fn signature_check_rejects_each_breach_of_the_contract() {
    let cases: [(&str, &[(&str, &str)]); 9] = [
        ("wrong identifier", &[("FAKE_IDENT", "com.example.other")]),
        ("wrong team", &[("FAKE_TEAM", "OTHER99999")]),
        ("no hardened runtime", &[("FAKE_FLAGS", "0x0(none)")]),
        ("no timestamp", &[("FAKE_NO_TIMESTAMP", "1")]),
        ("ad hoc", &[("FAKE_SIGNATURE", "adhoc")]),
        (
            "wrong authority",
            &[("FAKE_AUTH", "Apple Development: X (TEAM123456)")],
        ),
        ("verify fails", &[("FAKE_VERIFY_EXIT", "1")]),
        (
            "requirement names another team",
            &[("FAKE_REQ_TEAM", "OTHER99999")],
        ),
        (
            "requirement pins a hash",
            &[("FAKE_REQ_EXTRA", " and cdhash H\"abc\"")],
        ),
    ];
    for (name, env) in cases {
        let w = World::new();
        let out = verify_sig(&w, env, Some(TEAM));
        assert_eq!(out.status.code(), Some(1), "{name}: {}", text(&out));
        assert!(!w.path("signature.json").exists(), "{name}: wrote a record");
    }
}

#[test]
fn signature_check_needs_the_expected_team() {
    let w = World::new();
    assert_eq!(verify_sig(&w, &[], None).status.code(), Some(2));
}

// ---- notarize-macos.sh ---------------------------------------------------

fn notarize(w: &World, env: &[(&str, &str)], creds: bool) -> Output {
    let bin = w.binary();
    let mut c = w.cmd(
        "notarize-macos.sh",
        &[
            bin.to_str().unwrap(),
            T_ARM,
            w.path("evidence").to_str().unwrap(),
        ],
    );
    if creds {
        c.env("APPLE_ID", FAKE_APPLE_ID)
            .env("APPLE_TEAM_ID", TEAM)
            .env("APPLE_APP_PASSWORD", FAKE_APP_PW);
    }
    for (k, v) in env {
        c.env(k, v);
    }
    c.output().unwrap()
}

fn notary_record(w: &World) -> serde_json::Value {
    serde_json::from_str(&fs::read_to_string(w.path("evidence/notary.json")).unwrap()).unwrap()
}

#[test]
fn notarization_submits_a_zip_and_passes_only_on_accepted() {
    let w = World::new();
    let out = notarize(
        &w,
        &[("FAKE_NOTARY_JSON", r#"{"id":"sub-1","status":"Accepted"}"#)],
        true,
    );
    assert_eq!(out.status.code(), Some(0), "{}", text(&out));
    assert_no_secrets(&text(&out));
    let rec = notary_record(&w);
    assert_eq!(rec["status"], "Accepted");
    assert_eq!(rec["submission_id"], "sub-1");
    assert_eq!(rec["binary_sha256"].as_str().unwrap().len(), 64);
    let log = w.log();
    assert!(log.contains("notarytool submit"));
    assert!(log.contains(".zip"), "{log}");
    assert!(!log.contains(".tar.gz"));
    assert!(log.contains("--wait") && log.contains("--output-format json"));
    assert!(!log.contains("stapler"));
    assert_no_secrets(&fs::read_to_string(w.path("evidence/notary.json")).unwrap());
}

#[test]
fn notarization_that_is_not_accepted_stops_with_a_distinct_code_and_a_redacted_log() {
    let cases: [(&str, &str, &str, &str, i32); 5] = [
        (
            "invalid",
            r#"{"id":"sub-2","status":"Invalid"}"#,
            "0",
            "",
            4,
        ),
        (
            "rejected",
            r#"{"id":"sub-3","status":"Rejected"}"#,
            "1",
            "",
            4,
        ),
        (
            "still in progress",
            r#"{"id":"sub-4","status":"In Progress"}"#,
            "0",
            "",
            5,
        ),
        (
            "timeout",
            r#"{"id":"sub-5","status":"In Progress"}"#,
            "69",
            "",
            5,
        ),
        (
            "accepted but tool failed",
            r#"{"id":"sub-6","status":"Accepted"}"#,
            "1",
            "",
            5,
        ),
    ];
    for (name, json, exit, _, code) in cases {
        let w = World::new();
        let out = notarize(
            &w,
            &[("FAKE_NOTARY_JSON", json), ("FAKE_NOTARY_EXIT", exit)],
            true,
        );
        assert_eq!(out.status.code(), Some(code), "{name}: {}", text(&out));
        assert_no_secrets(&text(&out));
        assert_ne!(notary_record(&w)["status"], "Accepted", "{name}");
        let log = fs::read_to_string(w.path("evidence/notary-log.json")).unwrap();
        assert_no_secrets(&log);
        assert!(log.contains("[redacted]"), "{name}: {log}");
        assert!(!w.path("evidence/notary-log.raw.json").exists());
    }
}

#[test]
fn notarization_with_unreadable_output_fails_and_never_succeeds() {
    let w = World::new();
    let out = notarize(&w, &[("FAKE_NOTARY_JSON", "not json")], true);
    assert_eq!(out.status.code(), Some(5), "{}", text(&out));
}

#[test]
fn notarization_needs_all_three_credentials() {
    let w = World::new();
    let out = notarize(&w, &[], false);
    assert_eq!(out.status.code(), Some(2), "{}", text(&out));
    assert!(!w.log().contains("notarytool submit"));
}

#[test]
fn notarization_can_resume_an_earlier_submission_without_submitting_again() {
    let w = World::new();
    let out = notarize(
        &w,
        &[
            ("NOTARY_RESUME_ID", "sub-9"),
            ("FAKE_NOTARY_JSON", r#"{"id":"sub-9","status":"Accepted"}"#),
        ],
        true,
    );
    assert_eq!(out.status.code(), Some(0), "{}", text(&out));
    let log = w.log();
    assert!(log.contains("notarytool info sub-9"));
    assert!(!log.contains("notarytool submit"));
}

// ---- release-gate.py -----------------------------------------------------

struct Evidence {
    dir: tempfile::TempDir,
}

fn sha256(bytes: &[u8]) -> String {
    let mut child = Command::new("shasum")
        .args(["-a", "256"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    use std::io::Write;
    child.stdin.take().unwrap().write_all(bytes).unwrap();
    let out = child.wait_with_output().unwrap();
    String::from_utf8(out.stdout)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .to_string()
}

impl Evidence {
    /// Good evidence for both CPUs; each test then breaks one thing.
    fn new() -> Evidence {
        let e = Evidence {
            dir: tempfile::tempdir().unwrap(),
        };
        for target in [T_ARM, T_X86] {
            e.write_target(target, format!("signed-bytes-{target}").as_bytes());
        }
        e
    }

    fn target(&self, target: &str) -> PathBuf {
        self.dir.path().join("evidence").join(target)
    }

    fn write_target(&self, target: &str, binary: &[u8]) {
        let dir = self.target(target);
        fs::create_dir_all(&dir).unwrap();
        let stage = self.dir.path().join(format!("stage-{target}"));
        fs::create_dir_all(&stage).unwrap();
        fs::write(stage.join("agboard"), binary).unwrap();
        fs::write(stage.join("LICENSE"), "license").unwrap();
        fs::write(stage.join("THIRD_PARTY_NOTICES.txt"), "notices").unwrap();
        let status = Command::new("tar")
            .env("COPYFILE_DISABLE", "1")
            .args(["-czf"])
            .arg(dir.join(format!("agboard-1.0.0-{target}.tar.gz")))
            .arg("-C")
            .arg(&stage)
            .args(["agboard", "LICENSE", "THIRD_PARTY_NOTICES.txt"])
            .status()
            .unwrap();
        assert!(status.success());
        let hash = sha256(binary);
        fs::write(
            dir.join("signature.json"),
            serde_json::json!({
                "target": target, "identifier": ID, "team_id": TEAM,
                "authority": "Developer ID Application: Fixture (TEAM123456)",
                "runtime": true, "timestamp": true, "binary_sha256": hash, "sha": "abc123"
            })
            .to_string(),
        )
        .unwrap();
        fs::write(
            dir.join("notary.json"),
            serde_json::json!({
                "target": target, "submission_id": "sub", "status": "Accepted",
                "binary_sha256": hash, "zip_sha256": "z"
            })
            .to_string(),
        )
        .unwrap();
    }

    fn edit(&self, target: &str, file: &str, key: &str, value: serde_json::Value) {
        let path = self.target(target).join(file);
        let mut json: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        json[key] = value;
        fs::write(path, json.to_string()).unwrap();
    }

    fn gate(&self, extra: &[&str]) -> Output {
        Command::new("python3")
            .arg("-I")
            .arg(script("release-gate.py"))
            .args(["--evidence"])
            .arg(self.dir.path().join("evidence"))
            .args(["--version", "1.0.0", "--out"])
            .arg(self.dir.path().join("out"))
            .args(extra)
            .env("TZ", "UTC")
            .output()
            .unwrap()
    }

    fn produced(&self) -> bool {
        self.dir.path().join("out").exists()
    }
}

#[test]
fn gate_passes_when_both_cpus_are_signed_and_accepted_and_writes_checksums() {
    let e = Evidence::new();
    let out = e.gate(&["--sha", "abc123", "--team-id", TEAM]);
    assert_eq!(out.status.code(), Some(0), "{}", text(&out));
    let sums = fs::read_to_string(e.dir.path().join("out/assets/SHA256SUMS")).unwrap();
    let mut lines = sums.lines();
    for target in [T_ARM, T_X86] {
        let name = format!("agboard-1.0.0-{target}.tar.gz");
        let bytes = fs::read(e.target(target).join(&name)).unwrap();
        assert_eq!(lines.next().unwrap(), format!("{}  {name}", sha256(&bytes)));
        assert!(e.dir.path().join("out/assets").join(&name).is_file());
    }
    assert!(lines.next().is_none());
}

#[test]
fn gate_fails_when_one_cpu_has_no_evidence() {
    for missing in [T_ARM, T_X86] {
        let e = Evidence::new();
        fs::remove_dir_all(e.target(missing)).unwrap();
        let out = e.gate(&[]);
        assert_eq!(out.status.code(), Some(1), "{}", text(&out));
        assert!(text(&out).contains(missing) && text(&out).contains("FAILED"));
        assert!(!e.produced(), "assets were produced for a failed gate");
    }
}

#[test]
fn gate_fails_when_a_cpu_is_missing_its_archive_or_records() {
    for file in [
        "agboard-1.0.0-x86_64-apple-darwin.tar.gz",
        "signature.json",
        "notary.json",
    ] {
        let e = Evidence::new();
        fs::remove_file(e.target(T_X86).join(file)).unwrap();
        let out = e.gate(&[]);
        assert_eq!(out.status.code(), Some(1), "{file}: {}", text(&out));
        assert!(!e.produced());
    }
}

#[test]
fn gate_fails_unless_notarization_is_accepted_on_both_cpus() {
    for status in ["Invalid", "Rejected", "In Progress", "Unknown", ""] {
        let e = Evidence::new();
        e.edit(T_ARM, "notary.json", "status", status.into());
        let out = e.gate(&[]);
        assert_eq!(out.status.code(), Some(1), "{status}: {}", text(&out));
        assert!(text(&out).contains("not Accepted"));
        assert!(!e.produced());
    }
}

#[test]
fn gate_checks_identifier_team_runtime_timestamp_and_authority() {
    let cases: [(&str, &str, serde_json::Value); 5] = [
        ("identifier", "identifier", "com.example.other".into()),
        ("runtime", "runtime", false.into()),
        ("timestamp", "timestamp", false.into()),
        ("authority", "authority", "Apple Development: X (T)".into()),
        ("team", "team_id", "OTHER99999".into()),
    ];
    for (name, key, value) in cases {
        let e = Evidence::new();
        e.edit(T_X86, "signature.json", key, value);
        let out = e.gate(&[]);
        assert_eq!(out.status.code(), Some(1), "{name}: {}", text(&out));
        assert!(!e.produced(), "{name}");
    }
}

#[test]
fn gate_rejects_a_team_that_is_not_the_expected_one_even_when_both_cpus_agree() {
    let e = Evidence::new();
    let out = e.gate(&["--team-id", "OTHER99999"]);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
    assert!(text(&out).contains("Team ID"));
}

#[test]
fn gate_rejects_a_binary_that_changed_after_signing_or_after_notarization() {
    // The archive holds other bytes than the ones that were signed.
    let e = Evidence::new();
    e.write_target(T_ARM, b"bytes changed after signing");
    let sig = e.target(T_ARM).join("signature.json");
    let notary = e.target(T_ARM).join("notary.json");
    let original = Evidence::new();
    fs::copy(original.target(T_ARM).join("signature.json"), &sig).unwrap();
    fs::copy(original.target(T_ARM).join("notary.json"), &notary).unwrap();
    let out = e.gate(&[]);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
    assert!(text(&out).contains("not the same bytes"));

    // The notarized bytes differ from the signed bytes.
    let e = Evidence::new();
    e.edit(T_X86, "notary.json", "binary_sha256", "0".repeat(64).into());
    let out = e.gate(&[]);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
    assert!(text(&out).contains("not the same bytes"));
    assert!(!e.produced());
}

#[test]
fn gate_rejects_a_signature_made_for_another_commit() {
    let e = Evidence::new();
    let out = e.gate(&["--sha", "different"]);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
}

#[test]
fn gate_rejects_an_archive_with_unexpected_members() {
    let e = Evidence::new();
    let dir = e.target(T_ARM);
    let stage = e.dir.path().join("extra");
    fs::create_dir_all(&stage).unwrap();
    fs::write(stage.join("agboard"), format!("signed-bytes-{T_ARM}")).unwrap();
    fs::write(stage.join("stray"), "x").unwrap();
    let status = Command::new("tar")
        .env("COPYFILE_DISABLE", "1")
        .arg("-czf")
        .arg(dir.join(format!("agboard-1.0.0-{T_ARM}.tar.gz")))
        .arg("-C")
        .arg(&stage)
        .args(["agboard", "stray"])
        .status()
        .unwrap();
    assert!(status.success());
    let out = e.gate(&[]);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
}

// ---- workflow ------------------------------------------------------------

/// The text of one top-level job of the workflow.
fn job(workflow: &str, name: &str) -> String {
    let header = format!("\n  {name}:\n");
    let start = workflow
        .find(&header)
        .unwrap_or_else(|| panic!("no job {name}"))
        + 1;
    let rest = &workflow[start + header.len() - 1..];
    let end = rest
        .lines()
        .skip(0)
        .scan(0usize, |pos, line| {
            let at = *pos;
            *pos += line.len() + 1;
            Some((at, line))
        })
        .find(|(_, l)| {
            l.starts_with("  ")
                && !l.starts_with("   ")
                && l.trim_end().ends_with(':')
                && !l.trim().starts_with('#')
        })
        .map(|(at, _)| at)
        .unwrap_or(rest.len());
    rest[..end].to_string()
}

#[test]
fn candidate_jobs_have_no_secrets_no_signing_and_no_write_access() {
    let wf = fs::read_to_string(repo(".github/workflows/release.yml")).unwrap();
    for name in ["version", "build", "candidates"] {
        let j = job(&wf, name);
        assert!(!j.contains("secrets."), "{name} touches secrets");
        assert!(
            !j.contains("notarytool") && !j.contains("sign-macos"),
            "{name}"
        );
        assert!(
            !j.contains("contents: write") && !j.contains("environment:"),
            "{name}"
        );
    }
    assert!(job(&wf, "build").contains("\"signed\":false"));
}

#[test]
fn secrets_and_write_access_live_only_in_the_formal_path() {
    let wf = fs::read_to_string(repo(".github/workflows/release.yml")).unwrap();
    let sign = job(&wf, "sign");
    assert!(sign.contains("environment: release-signing"));
    assert!(sign.contains("github.event_name != 'pull_request'"));
    assert!(sign.contains("github.ref_type == 'tag'"));
    assert!(sign.contains("needs: [version, build, candidates]"));
    for secret in [
        "MACOS_CERT_P12",
        "MACOS_CERT_PASSWORD",
        "APPLE_ID",
        "APPLE_TEAM_ID",
        "APPLE_APP_PASSWORD",
    ] {
        assert!(
            sign.contains(&format!("secrets.{secret}")),
            "sign lacks {secret}"
        );
    }
    // No secret value is written into the YAML and `set -x` is never used.
    assert!(!wf.contains("set -x") && !wf.contains("-x\n"));
    // Cleanup always runs, after everything else in the job.
    let cleanup_at = sign.find("sign-macos.sh cleanup").unwrap();
    let step = sign[..cleanup_at].rsplit("- name:").next().unwrap();
    assert!(step.contains("if: always()"), "cleanup must always run");
    assert_eq!(
        sign[cleanup_at..].matches("- name:").count(),
        0,
        "last step"
    );
    assert!(sign.rfind("if: always()").unwrap() < cleanup_at);
    // No other job reads a secret, and only the draft job can write contents.
    for name in [
        "release-gate",
        "release-draft",
        "version",
        "build",
        "candidates",
    ] {
        assert!(!job(&wf, name).contains("secrets."), "{name}");
    }
    assert!(
        !wf.contains("contents: write") || job(&wf, "release-draft").contains("contents: write")
    );
    assert_eq!(wf.matches("contents: write").count(), 1);
    // The draft depends on the gate, which depends on every signing job.
    assert!(job(&wf, "release-gate").contains("needs: [version, sign]"));
    assert!(job(&wf, "release-draft").contains("needs: [version, release-gate]"));
    assert!(job(&wf, "release-draft").contains("--draft"));
    assert!(
        !wf.contains("if: always() && needs"),
        "a gate that ignores failure"
    );
    // Signing happens before the pack, and the pack before the gate's inputs.
    let (s, n, p) = (
        sign.find("sign-macos.sh sign").unwrap(),
        sign.find("notarize-macos.sh").unwrap(),
        sign.find("package.sh").unwrap(),
    );
    assert!(s < n && n < p, "order must be sign, notarize, pack");
    assert!(!sign.contains("stapler"));
}

#[test]
fn workflow_is_valid_yaml() {
    let ok = Command::new("python3")
        .args(["-c", "import sys,yaml;yaml.safe_load(open(sys.argv[1]))"])
        .arg(repo(".github/workflows/release.yml"))
        .output()
        .unwrap();
    if text(&ok).contains("No module named") {
        eprintln!("PyYAML is not installed; the YAML parse is skipped");
        return;
    }
    assert!(ok.status.success(), "{}", text(&ok));
}

#[test]
fn the_scripts_parse() {
    for name in ["sign-macos.sh", "verify-signature.sh", "notarize-macos.sh"] {
        let out = Command::new("bash")
            .arg("-n")
            .arg(script(name))
            .output()
            .unwrap();
        assert!(out.status.success(), "{name}: {}", text(&out));
    }
}
