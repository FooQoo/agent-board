//! The ngrok monitor connection: command line, saved settings, the PC-only API
//! and the start/stop supervision, over real HTTP on loopback.
//!
//! No test connects to ngrok: the endpoint is opened by a fake connector, so a
//! "ready" status here proves the supervision, not a real tunnel.

#[path = "support/mobile_monitor.rs"]
mod support;

use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use agent_board::cli::args::{
    Command as CliCommand, NgrokRequest, Parsed, parse, validate_monitor_args,
};
use agent_board::server::MonitorReady;
use agent_board::server::monitor_connection::config::ConfigStore;
use agent_board::server::monitor_connection::contracts::{ConnectionConfig, OauthApp};
use agent_board::server::monitor_connection::lifecycle::Overrides;
use assert_cmd::Command;
use serde_json::{Value, json};
use support::{ORIGIN, home};

// ------------------------------------------------------------- command line

fn agboard(home: &Path) -> Command {
    let mut cmd = Command::cargo_bin("agboard").unwrap();
    cmd.env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .env_remove("NGROK_AUTHTOKEN")
        .env_remove("AGBOARD_GOOGLE_CLIENT_ID")
        .env_remove("AGBOARD_GOOGLE_CLIENT_SECRET")
        .current_dir(home);
    cmd
}

fn exit_of(args: &[&str], envs: &[(&str, &str)]) -> (i32, String) {
    let home = tempfile::tempdir().unwrap();
    let mut cmd = agboard(home.path());
    // A port that would be used if parsing wrongly succeeded; never 7420.
    cmd.args(["serve", "--port", "8811"]).args(args);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let out = cmd.timeout(Duration::from_secs(20)).output().unwrap();
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    (out.status.code().unwrap_or(-1), text)
}

#[test]
fn bad_command_lines_exit_with_2_and_never_print_the_token() {
    let env = [("NGROK_AUTHTOKEN", TOKEN)];
    let ok_email = ["--ngrok-allow-email", "me@example.com"];
    let cases: Vec<Vec<&str>> = vec![
        vec!["--monitor", "lan"],
        vec!["--monitor", "both"],
        vec!["--monitor", "lan", "--ngrok-allow-email", "me@example.com"],
        vec!["--monitor", "ngrok", "--lan-port", "8812"],
        vec!["--monitor", "ngrok", "--lan-host", "0.0.0.0"],
        vec!["--monitor", "ngrok"],
        vec!["--monitor", "ngrok", "--ngrok-allow-email", ""],
        vec!["--monitor", "ngrok", "--ngrok-allow-email", "not-an-email"],
        vec![
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "a b@example.com",
        ],
        vec![
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "a\u{7}@example.com",
        ],
        vec![
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "a'b@example.com",
        ],
        vec![
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "me@example.com",
            "--ngrok-allow-email",
            "x",
        ],
        vec![
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "me@example.com",
            "--ngrok-domain",
            "https://a.ngrok.app",
        ],
        vec![
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "me@example.com",
            "--ngrok-domain",
            "a.ngrok.app:443",
        ],
        vec![
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "me@example.com",
            "--ngrok-oauth-app",
            "other",
        ],
        vec![
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "me@example.com",
            "--ngrok-oauth-app",
            "custom",
        ],
        vec![
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "me@example.com",
            "--remote-port",
            "8813",
            "--remote-origin",
            "https://x.example",
        ],
        vec!["--ngrok-allow-email", "me@example.com"],
        vec!["--ngrok-domain", "a.ngrok.app"],
    ];
    for case in cases {
        let (code, text) = exit_of(&case, &env);
        assert_eq!(code, 2, "{case:?}: {text}");
        assert!(!text.contains(TOKEN), "{case:?} printed the token");
    }
    // custom needs both Google values
    for envs in [
        vec![
            ("NGROK_AUTHTOKEN", TOKEN),
            ("AGBOARD_GOOGLE_CLIENT_ID", "id"),
        ],
        vec![
            ("NGROK_AUTHTOKEN", TOKEN),
            ("AGBOARD_GOOGLE_CLIENT_SECRET", "gsecret"),
        ],
    ] {
        let mut args = vec!["--monitor", "ngrok", "--ngrok-oauth-app", "custom"];
        args.extend(ok_email);
        let (code, text) = exit_of(&args, &envs);
        assert_eq!(code, 2, "{text}");
        assert!(!text.contains("gsecret") && !text.contains(TOKEN));
    }
    // the token must come from the environment
    let mut args = vec!["--monitor", "ngrok"];
    args.extend(ok_email);
    let (code, _) = exit_of(&args, &[]);
    assert_eq!(code, 2);
    let (code, text) = exit_of(
        &[
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "me@example.com",
            "--ngrok-token",
            TOKEN,
        ],
        &[],
    );
    assert_eq!(code, 2);
    assert!(!text.contains(TOKEN) || text.contains("--ngrok-token"));
}

#[test]
fn a_valid_ngrok_command_line_is_accepted_and_normalized() {
    let argv: Vec<std::ffi::OsString> = [
        "agboard",
        "serve",
        "--monitor",
        "ngrok",
        "--ngrok-allow-email",
        "Me@Example.com",
        "--ngrok-allow-email",
        "me@example.com",
        "--ngrok-domain",
        "cli.ngrok.app",
        "--ngrok-oauth-app",
        "custom",
    ]
    .iter()
    .map(Into::into)
    .collect();
    let Ok(Parsed::Run(cli)) = parse(&argv) else {
        panic!("the command line must parse");
    };
    // `validate` reads the real environment; the pure check below takes it as a parameter.
    let CliCommand::Serve(args) = &cli.command else {
        panic!("serve expected");
    };
    let env = |name: &str| match name {
        "NGROK_AUTHTOKEN" | "AGBOARD_GOOGLE_CLIENT_ID" | "AGBOARD_GOOGLE_CLIENT_SECRET" => {
            Some("set".to_string())
        }
        _ => None,
    };
    let request = validate_monitor_args(args, &env).unwrap().unwrap();
    assert_eq!(
        request,
        NgrokRequest {
            allow_emails: vec!["me@example.com".into()],
            domain: Some("cli.ngrok.app".into()),
            oauth_app: Some(agent_board::server::monitor_connection::contracts::OauthApp::Custom),
        }
    );
    // Without --monitor, plain serve has no monitor request.
    let plain: Vec<std::ffi::OsString> = ["agboard", "serve"].iter().map(Into::into).collect();
    let Ok(Parsed::Run(cli)) = parse(&plain) else {
        panic!("serve must parse");
    };
    let CliCommand::Serve(args) = &cli.command else {
        panic!("serve expected");
    };
    assert_eq!(validate_monitor_args(args, &env).unwrap(), None);
}

#[path = "support/ngrok_harness.rs"]
mod harness;
use harness::*;

// ------------------------------------------------------------- the local API

#[test]
fn get_returns_only_non_secret_state_and_only_to_the_local_page() {
    let home = home();
    let s = Server::start(home.path(), Opts::default());
    let v = s.get();
    let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "failure",
            "revision",
            "settings",
            "status",
            "tokenConfigured",
            "url"
        ]
    );
    assert_eq!(v["status"], "disabled");
    assert_eq!(v["tokenConfigured"], false);
    assert_eq!(v["settings"]["enabled"], false);
    let path = "/api/monitor-connections";
    assert_eq!(
        request(s.local, "GET", path, &[("Host", "evil.example")], "").status,
        403
    );
    assert_eq!(
        request(
            s.local,
            "GET",
            path,
            &[("Sec-Fetch-Site", "cross-site")],
            ""
        )
        .status,
        403
    );
    assert_eq!(
        request(
            s.local,
            "GET",
            path,
            &[("Origin", "http://evil.example")],
            ""
        )
        .status,
        403
    );
    // A write without the page's proof is refused before anything is looked at.
    let bare = request(
        s.local,
        "PUT",
        "/api/monitor-connections/settings/ngrok",
        &[],
        "{}",
    );
    assert_eq!(bare.status, 403);
    let bare = request(
        s.local,
        "POST",
        "/api/monitor-connections/transports/ngrok/start",
        &[],
        "{}",
    );
    assert_eq!(bare.status, 403);
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
}

#[test]
fn settings_use_revisions_validate_input_and_are_saved_privately() {
    let home = home();
    let s = Server::start(home.path(), Opts::default());
    let r = s.put(true, &["Me@Example.com"], 0);
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.json()["revision"], 1);
    assert_eq!(
        r.json()["settings"]["allowEmails"],
        json!(["me@example.com"])
    );
    assert_eq!(r.json()["status"], "needs_config");
    // a stale revision conflicts and changes nothing
    let r = s.put(false, &["other@example.com"], 0);
    assert_eq!(r.status, 409);
    assert_eq!(r.json()["error"]["code"], "revision_conflict");
    assert_eq!(
        s.get()["settings"]["allowEmails"],
        json!(["me@example.com"])
    );
    // invalid input
    for (enabled, emails) in [
        (true, vec![]),
        (true, vec!["a b@x.com"]),
        (false, vec!["bad"]),
    ] {
        let r = s.put(enabled, &emails, 1);
        assert_eq!(r.status, 422, "{emails:?}");
    }
    assert_eq!(s.get()["revision"], 1);
    let saved = ConfigStore::new(home.path()).load().unwrap();
    assert_eq!(saved.revision, 1);
    assert!(saved.enabled);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(home.path().join("monitor/config.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[cfg(unix)]
#[test]
fn a_failed_save_changes_nothing_and_starts_nothing() {
    use std::os::unix::fs::PermissionsExt;
    let home = home();
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    assert_eq!(s.put(false, &[], 0).status, 200);
    let dir = home.path().join("monitor");
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    let r = s.put(true, &["me@example.com"], 1);
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(r.status, 500, "{}", r.body);
    assert_eq!(r.json()["error"]["code"], "save_failed");
    let v = s.get();
    assert_eq!(v["revision"], 1);
    assert_eq!(v["settings"]["enabled"], false);
    assert_eq!(v["status"], "disabled");
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
    assert!(!ConfigStore::new(home.path()).load().unwrap().enabled);
}

// ------------------------------------------------------- start, stop, secrets

#[test]
fn start_keeps_the_token_in_memory_and_guards_the_backend() {
    let home = home();
    let s = Server::start(home.path(), Opts::default());
    // no token held and none given
    assert_eq!(s.put(true, &["me@example.com"], 0).status, 200);
    let r = s.start_ngrok(json!({}));
    assert_eq!(r.status, 422);
    assert_eq!(r.json()["error"]["code"], "token_required");
    // a token that cannot be one
    assert_eq!(s.start_ngrok(json!({"token": "a b"})).status, 422);
    assert_eq!(s.start_ngrok(json!({"token": ""})).status, 422);
    assert_eq!(
        s.start_ngrok(json!({"token": TOKEN, "extra": 1})).status,
        422
    );
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);

    let (release, hold) = mpsc::channel();
    *s.fake.hold.lock().unwrap() = Some(hold);
    let r = s.start_ngrok(json!({"token": TOKEN}));
    assert_eq!(r.status, 202, "{}", r.body);
    assert!(!r.body.contains(TOKEN));
    assert_eq!(r.json()["status"], "starting");
    let start = s.wait_status("starting");
    assert_eq!(start["tokenConfigured"], true);
    assert_eq!(start["url"], Value::Null);

    // While the policy is not known the backend refuses everything.
    let (backend, policy) = {
        let calls = s.fake.calls.lock().unwrap();
        let call = calls.last().unwrap();
        assert_eq!(call.token, TOKEN);
        (backend_addr(call), call.policy.clone())
    };
    assert_eq!(request(backend, "GET", "/", &[], "").status, 403);
    release.send(()).unwrap();
    let ready = s.wait_status("ready");
    assert_eq!(ready["url"], PUBLIC);

    // With the right Host and the real proof the entrance admits only the
    // monitor's own routes; everything else is unknown to it. Sessions, CSRF
    // and the rest are covered in monitor_ngrok.rs.
    let proof = serde_json::from_str::<Value>(&policy).unwrap()["on_http_request"][3]["actions"][0]
        ["config"]["headers"]["x-agboard-tunnel-proof"]
        .as_str()
        .unwrap()
        .to_string();
    let host = PUBLIC.trim_start_matches("https://");
    let admitted = [("Host", host), ("x-agboard-tunnel-proof", proof.as_str())];
    for (path, want) in [
        ("/monitor/", 200),
        ("/monitor/api/session", 200),
        ("/", 404),
        ("/api/projects", 404),
        ("/api/monitor-connections", 404),
    ] {
        let r = request(backend, "GET", path, &admitted, "");
        assert_eq!(r.status, want, "{path}");
        assert!(!r.body.contains(&proof));
    }
    for (path, headers) in [
        ("/", vec![("Host", host)]),
        (
            "/",
            vec![
                ("Host", "127.0.0.1"),
                ("x-agboard-tunnel-proof", proof.as_str()),
            ],
        ),
        (
            "/monitor/",
            vec![
                ("x-agboard-tunnel-proof", "forged"),
                ("ngrok-auth-user-email", "me@example.com"),
            ],
        ),
    ] {
        let r = request(backend, "GET", path, &headers, "");
        assert_eq!(r.status, 403, "{path} {headers:?}");
    }
    assert_eq!(
        request(backend, "POST", "/monitor/api/answer", &admitted, "{}").status,
        401
    );

    // The token is nowhere on disk and not in any API answer.
    let disk = all_files_text(home.path());
    assert!(!disk.contains(TOKEN) && !disk.contains(&proof));
    assert!(!s.get().to_string().contains(TOKEN));
    assert!(!s.put(true, &["me@example.com"], 1).body.contains(TOKEN));

    // Stopping closes the backend, forgets the URL and saves enabled: false.
    let r = s.stop_ngrok();
    assert_eq!(r.status, 200);
    assert_eq!(r.json()["status"], "disabled");
    assert_eq!(r.json()["url"], Value::Null);
    assert_eq!(r.json()["settings"]["enabled"], false);
    std::thread::sleep(Duration::from_millis(100));
    assert!(std::net::TcpStream::connect_timeout(&backend, Duration::from_millis(500)).is_err());
    assert!(!ConfigStore::new(home.path()).load().unwrap().enabled);
    assert!(!all_files_text(home.path()).contains(TOKEN));
}

#[test]
fn stopping_while_connecting_never_publishes_the_old_tunnel() {
    let home = home();
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    assert_eq!(s.put(true, &["me@example.com"], 0).status, 200);
    let (release, hold) = mpsc::channel();
    *s.fake.hold.lock().unwrap() = Some(hold);
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    s.wait_status("starting");
    let backend = backend_addr(s.fake.calls.lock().unwrap().last().unwrap());
    assert_eq!(s.stop_ngrok().json()["status"], "disabled");
    let _ = release.send(());
    std::thread::sleep(Duration::from_millis(300));
    let v = s.get();
    assert_eq!(v["status"], "disabled");
    assert_eq!(v["url"], Value::Null);
    assert!(std::net::TcpStream::connect_timeout(&backend, Duration::from_millis(500)).is_err());
}

#[test]
fn a_failed_start_is_reported_without_a_secret_and_can_be_retried() {
    let home = home();
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    assert_eq!(s.put(true, &["me@example.com"], 0).status, 200);
    *s.fake.fail.lock().unwrap() = true;
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    let v = s.wait_status("failed");
    assert_eq!(v["failure"], "connect_failed");
    assert_eq!(v["url"], Value::Null);
    assert!(!v.to_string().contains(TOKEN));
    // the PC entrance still works
    assert_eq!(
        request(s.local, "GET", "/api/projects", &[], "").status,
        200
    );
    *s.fake.fail.lock().unwrap() = false;
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    assert_eq!(s.wait_status("ready")["url"], PUBLIC);
}

#[test]
fn changing_the_allow_list_replaces_the_tunnel_and_the_proof() {
    let home = home();
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    assert_eq!(s.put(true, &["me@example.com"], 0).status, 200);
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    s.wait_status("ready");
    let first = backend_addr(s.fake.calls.lock().unwrap().last().unwrap());
    assert_eq!(
        s.put(true, &["me@example.com", "you@example.com"], 1)
            .status,
        200
    );
    let end = Instant::now() + Duration::from_secs(5);
    while s.fake.opens.load(Ordering::SeqCst) < 2 {
        assert!(Instant::now() < end);
        std::thread::sleep(Duration::from_millis(20));
    }
    s.wait_status("ready");
    let calls = s.fake.calls.lock().unwrap();
    assert_ne!(calls[0].policy, calls[1].policy);
    assert!(calls[1].policy.contains("you@example.com"));
    drop(calls);
    std::thread::sleep(Duration::from_millis(100));
    assert!(std::net::TcpStream::connect_timeout(&first, Duration::from_millis(500)).is_err());
    // disabling stops it
    assert_eq!(
        s.put(false, &["me@example.com", "you@example.com"], 2)
            .json()["status"],
        "disabled"
    );
}

// ------------------------------------------------------- startup and restore

#[test]
fn a_saved_enabled_setting_is_restored_only_with_a_token() {
    let home = home();
    ConfigStore::new(home.path())
        .save(&ConnectionConfig {
            enabled: true,
            allow_emails: vec!["me@example.com".into()],
            domain: None,
            oauth_app: OauthApp::Managed,
            revision: 4,
        })
        .unwrap();
    {
        let s = Server::start(home.path(), Opts::default());
        let v = s.get();
        assert_eq!(v["status"], "needs_config");
        assert_eq!(v["revision"], 4);
        assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
    }
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    assert_eq!(s.wait_status("ready")["url"], PUBLIC);
}

#[test]
fn an_unreadable_settings_file_keeps_the_pc_entrance_and_can_be_replaced() {
    let home = home();
    std::fs::create_dir_all(home.path().join("monitor")).unwrap();
    std::fs::write(home.path().join("monitor/config.json"), "{ not json").unwrap();
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    let v = s.get();
    assert_eq!(v["status"], "failed");
    assert_eq!(v["failure"], "config_unreadable");
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
    assert_eq!(
        request(s.local, "GET", "/api/projects", &[], "").status,
        200
    );
    assert_eq!(s.start_ngrok(json!({})).status, 409);
    assert_eq!(s.put(false, &[], 0).status, 200);
    assert_eq!(s.get()["status"], "disabled");
}

#[test]
fn a_start_on_a_disabled_setting_saves_it_as_enabled_first() {
    let home = home();
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    assert_eq!(s.put(false, &["me@example.com"], 0).status, 200);
    assert!(!ConfigStore::new(home.path()).load().unwrap().enabled);
    // Without an allowed email the start is refused and nothing is saved.
    assert_eq!(s.put(false, &[], 1).status, 200);
    assert_eq!(s.start_ngrok(json!({})).status, 422);
    assert!(!ConfigStore::new(home.path()).load().unwrap().enabled);
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
    // With one, the start saves enabled under the next revision.
    assert_eq!(s.put(false, &["me@example.com"], 2).status, 200);
    let r = s.start_ngrok(json!({}));
    assert_eq!(r.status, 202, "{}", r.body);
    assert_eq!(r.json()["revision"], 4);
    s.wait_status("ready");
    let saved = ConfigStore::new(home.path()).load().unwrap();
    assert!(saved.enabled);
    assert_eq!(saved.revision, 4);
    // The enabled setting survives a restart and the connection is restored.
    drop(s);
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    assert_eq!(s.wait_status("ready")["url"], PUBLIC);
}

#[test]
fn a_legacy_remote_run_does_not_restore_the_ngrok_connection() {
    let home = home();
    ConfigStore::new(home.path())
        .save(&ConnectionConfig {
            enabled: true,
            allow_emails: vec!["me@example.com".into()],
            domain: None,
            oauth_app: OauthApp::Managed,
            revision: 1,
        })
        .unwrap();
    let s = Server::start(
        home.path(),
        Opts {
            remote: true,
            env_token: true,
            ..Opts::default()
        },
    );
    let v = s.get();
    assert_eq!(v["status"], "disabled");
    assert_eq!(v["url"], Value::Null);
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
    // Its saved setting is untouched.
    assert!(ConfigStore::new(home.path()).load().unwrap().enabled);
}

#[test]
fn an_explicit_start_announces_after_it_is_up_and_overrides_saved_settings() {
    let home = home();
    ConfigStore::new(home.path())
        .save(&ConnectionConfig {
            enabled: false,
            allow_emails: vec!["saved@example.com".into()],
            domain: None,
            oauth_app: OauthApp::Managed,
            revision: 2,
        })
        .unwrap();
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            explicit: Some(Overrides {
                allow_emails: vec!["cli@example.com".into()],
                domain: Some("cli.ngrok.app".into()),
                oauth_app: None,
            }),
            ..Opts::default()
        },
    );
    assert_eq!(s.ready, Some(MonitorReady { url: PUBLIC.into() }));
    let calls = s.fake.calls.lock().unwrap();
    assert!(calls[0].policy.contains("cli@example.com"));
    assert!(!calls[0].policy.contains("saved@example.com"));
    drop(calls);
    let v = s.get();
    assert_eq!(v["status"], "ready");
    assert_eq!(v["settings"]["allowEmails"], json!(["cli@example.com"]));
    assert_eq!(v["settings"]["domain"], "cli.ngrok.app");
    assert_eq!(v["revision"], 2);
    // the command line is not written back
    assert_eq!(
        ConfigStore::new(home.path()).load().unwrap().allow_emails,
        vec!["saved@example.com".to_string()]
    );
}

#[test]
fn a_failed_explicit_start_ends_the_run_and_leaves_no_serve_file() {
    let home = home();
    let fake = Arc::new(Fake::default());
    *fake.fail.lock().unwrap() = true;
    let result = Server::try_start(
        home.path(),
        Opts {
            env_token: true,
            fake,
            explicit: Some(Overrides {
                allow_emails: vec!["me@example.com".into()],
                domain: None,
                oauth_app: None,
            }),
            ..Opts::default()
        },
    );
    let error = result.err().expect("the run must fail");
    assert_eq!(error.exit_code(), 1);
    assert!(!error.message().contains(TOKEN));
    assert!(!home.path().join("serve.json").exists());
}

// ------------------------------------------------------- other entrances

#[test]
fn the_remote_entrance_has_no_management_api() {
    let home = home();
    let s = Server::start(
        home.path(),
        Opts {
            remote: true,
            ..Opts::default()
        },
    );
    let remote = s.remote.unwrap();
    let origin = ORIGIN;
    let host = ORIGIN.trim_start_matches("https://");
    let calls = [
        ("GET", "/api/monitor-connections"),
        ("PUT", "/api/monitor-connections/settings/ngrok"),
        ("POST", "/api/monitor-connections/transports/ngrok/start"),
        ("POST", "/api/monitor-connections/transports/ngrok/stop"),
        ("GET", "/monitor/api/monitor-connections"),
        ("GET", "/monitor/api/pairings"),
        ("GET", "/monitor/api/devices"),
    ];
    for (method, path) in calls {
        let r = request(
            remote,
            method,
            path,
            &[
                ("Host", host),
                ("Origin", origin),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Token", &s.token),
            ],
            "{}",
        );
        assert!(
            (403..=405).contains(&r.status),
            "{method} {path} -> {}",
            r.status
        );
        assert!(!r.body.contains("tokenConfigured") && !r.body.contains("allowEmails"));
    }
    // the local entrance does not serve the pairing/device routes either
    for path in [
        "/api/pairings",
        "/api/devices",
        "/api/monitor-connections/transports/lan/start",
    ] {
        let r = request(s.local, "GET", path, &[], "");
        assert!(matches!(r.status, 404 | 405), "{path} -> {}", r.status);
    }
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
}
