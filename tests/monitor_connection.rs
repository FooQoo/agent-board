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
use agent_board::server::monitor_connection::config::ConfigStore;
use agent_board::server::monitor_connection::contracts::ConnectionConfig;
use agent_board::server::monitor_connection::lifecycle::Overrides;
use assert_cmd::Command;
use serde_json::{Value, json};
use support::home;

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
    let cases: Vec<Vec<&str>> = vec![
        vec!["--monitor", "lan"],
        vec!["--monitor", "both"],
        vec!["--monitor", "lan", "--ngrok-domain", "a.ngrok.app"],
        vec!["--monitor", "ngrok", "--lan-port", "8812"],
        vec!["--monitor", "ngrok", "--lan-host", "0.0.0.0"],
        vec![
            "--monitor",
            "ngrok",
            "--ngrok-domain",
            "https://a.ngrok.app",
        ],
        vec!["--monitor", "ngrok", "--ngrok-domain", "a.ngrok.app:443"],
        vec!["--monitor", "ngrok", "--ngrok-domain", "a b.ngrok.app"],
        vec![
            "--monitor",
            "ngrok",
            "--remote-port",
            "8813",
            "--remote-origin",
            "https://x.example",
        ],
        // The Google sign-in and its allow list are gone, with no stand-in.
        vec![
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "me@example.com",
        ],
        vec!["--ngrok-allow-email", "me@example.com"],
        vec!["--monitor", "ngrok", "--ngrok-oauth-app", "managed"],
        vec!["--monitor", "ngrok", "--ngrok-oauth-app", "custom"],
        // Options for the monitor need the monitor.
        vec!["--ngrok-domain", "a.ngrok.app"],
    ];
    for case in cases {
        let (code, text) = exit_of(&case, &env);
        assert_eq!(code, 2, "{case:?}: {text}");
        assert!(!text.contains(TOKEN), "{case:?} printed the token");
    }
    // The token must come from the environment, and the Google variables are not a substitute.
    let (code, text) = exit_of(&["--monitor", "ngrok"], &[]);
    assert_eq!(code, 2);
    assert!(text.contains("NGROK_AUTHTOKEN"), "{text}");
    let (code, text) = exit_of(
        &["--monitor", "ngrok"],
        &[
            ("AGBOARD_GOOGLE_CLIENT_ID", "gid"),
            ("AGBOARD_GOOGLE_CLIENT_SECRET", "gsecret"),
        ],
    );
    assert_eq!(code, 2);
    assert!(!text.contains("gsecret"));
    let (code, text) = exit_of(&["--monitor", "ngrok", "--ngrok-token", TOKEN], &[]);
    assert_eq!(code, 2);
    assert!(!text.contains(TOKEN) || text.contains("--ngrok-token"));
}

#[test]
fn a_valid_ngrok_command_line_is_accepted_and_normalized() {
    let parse_serve = |extra: &[&str]| {
        let mut argv: Vec<std::ffi::OsString> =
            ["agboard", "serve"].iter().map(Into::into).collect();
        argv.extend(extra.iter().map(Into::into));
        let Ok(Parsed::Run(cli)) = parse(&argv) else {
            panic!("the command line must parse: {extra:?}");
        };
        cli
    };
    // `validate` reads the real environment; the pure check below takes it as a parameter.
    let env = |name: &str| match name {
        "NGROK_AUTHTOKEN" => Some("set".to_string()),
        _ => None,
    };
    let check = |extra: &[&str]| {
        let cli = parse_serve(extra);
        let CliCommand::Serve(args) = &cli.command else {
            panic!("serve expected");
        };
        validate_monitor_args(args, &env).unwrap()
    };
    // The monitor needs no email and no Google app; the domain is optional.
    assert_eq!(
        check(&["--monitor", "ngrok"]),
        Some(NgrokRequest { domain: None })
    );
    assert_eq!(
        check(&["--monitor", "ngrok", "--ngrok-domain", "Cli.Ngrok.App"]),
        Some(NgrokRequest {
            domain: Some("cli.ngrok.app".into())
        })
    );
    // Without --monitor, plain serve has no monitor request.
    assert_eq!(check(&[]), None);
    // The token alone is not enough without the environment variable.
    let cli = parse_serve(&["--monitor", "ngrok"]);
    let CliCommand::Serve(args) = &cli.command else {
        panic!("serve expected");
    };
    assert!(validate_monitor_args(args, &|_| None).is_err());
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
            "keychainAvailable",
            "keychainTokenSaved",
            "revision",
            "settings",
            "status",
            "tokenConfigured",
            "tokenSource",
            "url"
        ]
    );
    assert_eq!(v["status"], "disabled");
    assert_eq!(v["tokenConfigured"], false);
    assert_eq!(v["tokenSource"], Value::Null);
    assert_eq!(v["keychainAvailable"], true);
    assert_eq!(v["keychainTokenSaved"], false);
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
    // A write without the page's token is refused before anything is looked at.
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
    let r = s.put(true, Some("Me.Ngrok.App"), 0);
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.json()["revision"], 1);
    assert_eq!(
        r.json()["settings"],
        json!({"enabled": true, "domain": "me.ngrok.app"})
    );
    assert_eq!(r.json()["status"], "needs_config");
    // a stale revision conflicts and changes nothing
    let r = s.put(false, Some("other.ngrok.app"), 0);
    assert_eq!(r.status, 409);
    assert_eq!(r.json()["error"]["code"], "revision_conflict");
    assert_eq!(s.get()["settings"]["domain"], "me.ngrok.app");
    // invalid input
    for domain in [
        "not a host",
        "https://a.ngrok.app",
        "a.ngrok.app:443",
        "localhost",
    ] {
        let r = s.put(true, Some(domain), 1);
        assert_eq!(r.status, 422, "{domain}");
    }
    // A blank domain means "let ngrok choose"; no email is needed to enable.
    let r = s.put(true, Some(" "), 1);
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.json()["settings"]["domain"], Value::Null);
    // The Google settings are no longer part of the contract.
    for extra in [
        json!({"allowEmails": ["me@example.com"]}),
        json!({"oauthApp": "managed"}),
    ] {
        let mut body = json!({"enabled": true, "domain": null, "revision": 2});
        body.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let r = s.write("PUT", "/api/monitor-connections/settings/ngrok", &body);
        assert_eq!(r.status, 422, "{body}");
    }
    let settings = s.get()["settings"].clone();
    assert_eq!(settings.as_object().unwrap().len(), 2);
    assert_eq!(s.get()["revision"], 2);
    let saved = ConfigStore::new(home.path()).load().unwrap();
    assert_eq!(saved.revision, 2);
    assert!(saved.enabled);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(home.path().join(".internal/monitor-connection.json"))
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
    assert_eq!(s.put(false, None, 0).status, 200);
    let dir = home.path().join(".internal");
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    let r = s.put(true, None, 1);
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
    assert_eq!(s.put(true, None, 0).status, 200);
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
    // No passcode is shown before the connection is up.
    assert!(start.get("passcode").is_none(), "{start}");

    // While the tunnel's public address is not known the backend refuses everything,
    // even a request that names the address the tunnel will get.
    let backend = {
        let calls = s.fake.calls.lock().unwrap();
        let call = calls.last().unwrap();
        assert_eq!(call.token, TOKEN);
        backend_addr(call)
    };
    assert_eq!(request(backend, "GET", "/", &[], "").status, 403);
    let host = PUBLIC.trim_start_matches("https://");
    let admitted = [("Host", host)];
    assert_eq!(
        request(backend, "GET", "/monitor/", &admitted, "").status,
        403
    );
    release.send(()).unwrap();
    let ready = s.wait_status("ready");
    assert_eq!(ready["url"], format!("{PUBLIC}/monitor/"));
    // Once up, the PC is shown the four-digit passcode of this start.
    let code = ready["passcode"].as_str().unwrap();
    assert!(
        code.len() == 4 && code.bytes().all(|b| b.is_ascii_digit()),
        "{code}"
    );

    // With the public Host the entrance admits only the monitor's own routes;
    // everything else is unknown to it. Sessions, CSRF and the rest are covered
    // in monitor_ngrok.rs.
    for (path, want) in [
        ("/monitor/", 200),
        // Merely asking for a session starts none: the passcode is needed.
        ("/monitor/api/session", 401),
        ("/", 404),
        ("/api/projects", 404),
        ("/api/monitor-connections", 404),
    ] {
        let r = request(backend, "GET", path, &admitted, "");
        assert_eq!(r.status, want, "{path}");
    }
    // Any other Host is refused, and headers a client writes to look like the Edge's are not a Host.
    for (path, headers) in [
        ("/", vec![("Host", "127.0.0.1")]),
        ("/monitor/", vec![("Host", "localhost")]),
        (
            "/monitor/",
            vec![
                ("ngrok-auth-user-email", "me@example.com"),
                ("X-Forwarded-Host", host),
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
    assert!(!disk.contains(TOKEN));
    assert!(!s.get().to_string().contains(TOKEN));
    assert!(!s.put(true, None, 1).body.contains(TOKEN));

    // Stopping closes the backend, forgets the URL and the passcode, and saves enabled: false.
    let r = s.stop_ngrok();
    assert_eq!(r.status, 200);
    assert_eq!(r.json()["status"], "disabled");
    assert_eq!(r.json()["url"], Value::Null);
    assert!(r.json().get("passcode").is_none(), "{}", r.body);
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
    assert_eq!(s.put(true, None, 0).status, 200);
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
    assert_eq!(s.put(true, None, 0).status, 200);
    *s.fake.fail.lock().unwrap() = true;
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    let v = s.wait_status("failed");
    assert_eq!(v["failure"], "connect_failed");
    assert_eq!(v["url"], Value::Null);
    // A connection that did not come up has no passcode to show.
    assert!(v.get("passcode").is_none(), "{v}");
    assert!(!v.to_string().contains(TOKEN));
    // the PC entrance still works
    assert_eq!(
        request(s.local, "GET", "/api/projects", &[], "").status,
        200
    );
    *s.fake.fail.lock().unwrap() = false;
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    assert_eq!(s.wait_status("ready")["url"], format!("{PUBLIC}/monitor/"));
}

#[test]
fn changing_the_domain_replaces_the_tunnel_and_an_equal_save_does_not() {
    let home = home();
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    assert_eq!(s.put(true, None, 0).status, 200);
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    s.wait_status("ready");
    let first = backend_addr(s.fake.calls.lock().unwrap().last().unwrap());
    // Saving what is already saved keeps the tunnel (and so the passcode).
    let before = s.passcode();
    assert_eq!(s.put(true, None, 1).status, 200);
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 1);
    assert_eq!(s.passcode(), before);
    // A different domain is a new tunnel.
    assert_eq!(s.put(true, Some("you.ngrok.app"), 2).status, 200);
    let end = Instant::now() + Duration::from_secs(5);
    while s.fake.opens.load(Ordering::SeqCst) < 2 {
        assert!(Instant::now() < end);
        std::thread::sleep(Duration::from_millis(20));
    }
    s.wait_status("ready");
    let calls = s.fake.calls.lock().unwrap();
    assert_ne!(calls[0].backend, calls[1].backend);
    assert_eq!(calls[0].domain, None);
    assert_eq!(calls[1].domain.as_deref(), Some("you.ngrok.app"));
    drop(calls);
    std::thread::sleep(Duration::from_millis(100));
    assert!(std::net::TcpStream::connect_timeout(&first, Duration::from_millis(500)).is_err());
    // disabling stops it
    let off = s.put(false, Some("you.ngrok.app"), 3);
    assert_eq!(off.json()["status"], "disabled");
    assert!(off.json().get("passcode").is_none());
}

// ------------------------------------------------------- startup and restore

#[test]
fn a_saved_enabled_setting_is_restored_only_with_a_token() {
    let home = home();
    ConfigStore::new(home.path())
        .save(&ConnectionConfig {
            enabled: true,
            domain: None,
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
    assert_eq!(s.wait_status("ready")["url"], format!("{PUBLIC}/monitor/"));
}

#[test]
fn an_unreadable_settings_file_keeps_the_pc_entrance_and_can_be_replaced() {
    let home = home();
    std::fs::create_dir_all(home.path().join(".internal")).unwrap();
    std::fs::write(
        home.path().join(".internal/monitor-connection.json"),
        "{ not json",
    )
    .unwrap();
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
    assert_eq!(s.put(false, None, 0).status, 200);
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
    assert_eq!(s.put(false, Some("saved.ngrok.app"), 0).status, 200);
    assert!(!ConfigStore::new(home.path()).load().unwrap().enabled);
    // Without a token the start is refused and nothing is saved.
    let bare = self::home();
    let t = Server::start(bare.path(), Opts::default());
    assert_eq!(t.put(false, None, 0).status, 200);
    assert_eq!(t.start_ngrok(json!({})).status, 422);
    assert!(!ConfigStore::new(bare.path()).load().unwrap().enabled);
    assert_eq!(t.fake.opens.load(Ordering::SeqCst), 0);
    drop(t);
    // With one, the start saves enabled under the next revision.
    let r = s.start_ngrok(json!({}));
    assert_eq!(r.status, 202, "{}", r.body);
    assert_eq!(r.json()["revision"], 2);
    s.wait_status("ready");
    let saved = ConfigStore::new(home.path()).load().unwrap();
    assert!(saved.enabled);
    assert_eq!(saved.revision, 2);
    assert_eq!(saved.domain.as_deref(), Some("saved.ngrok.app"));
    // The enabled setting survives a restart and the connection is restored.
    drop(s);
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    assert_eq!(s.wait_status("ready")["url"], format!("{PUBLIC}/monitor/"));
}

#[test]
fn an_explicit_start_announces_after_it_is_up_and_overrides_saved_settings() {
    let home = home();
    ConfigStore::new(home.path())
        .save(&ConnectionConfig {
            enabled: false,
            domain: Some("saved.ngrok.app".into()),
            revision: 2,
        })
        .unwrap();
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            explicit: Some(Overrides {
                domain: Some("cli.ngrok.app".into()),
            }),
            ..Opts::default()
        },
    );
    // The startup announces the URL together with the passcode the PC shows.
    let ready = s.ready.clone().expect("an explicit start announces itself");
    assert_eq!(ready.url, format!("{PUBLIC}/monitor/"));
    assert_eq!(ready.passcode.expose().len(), 4);
    assert!(ready.passcode.expose().bytes().all(|b| b.is_ascii_digit()));
    assert_eq!(s.get()["passcode"], ready.passcode.expose());
    assert!(!format!("{ready:?}").contains(ready.passcode.expose()));
    let calls = s.fake.calls.lock().unwrap();
    assert_eq!(calls[0].domain.as_deref(), Some("cli.ngrok.app"));
    drop(calls);
    let v = s.get();
    assert_eq!(v["status"], "ready");
    assert_eq!(v["settings"]["domain"], "cli.ngrok.app");
    assert_eq!(v["revision"], 2);
    // the command line is not written back
    assert_eq!(
        ConfigStore::new(home.path())
            .load()
            .unwrap()
            .domain
            .as_deref(),
        Some("saved.ngrok.app")
    );
    // and the passcode is not written anywhere
    assert!(
        !all_files_text(home.path())
            .to_lowercase()
            .contains("passcode")
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
            explicit: Some(Overrides { domain: None }),
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
fn the_local_entrance_serves_no_pairing_or_device_routes() {
    let home = home();
    let s = Server::start(home.path(), Opts::default());
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

// ------------------------------------------------- internal area and keychain

const SAVED: &str = "tok-KEYCHAIN-9876543210";

#[test]
fn settings_live_in_the_internal_area_and_no_settings_file_is_made() {
    let home = home();
    let s = Server::start(home.path(), Opts::default());
    assert_eq!(s.put(true, Some("me.ngrok.app"), 0).status, 200);
    let file = home.path().join(".internal/monitor-connection.json");
    assert!(file.is_file());
    assert!(!home.path().join("monitor").exists());
    assert_eq!(
        ConfigStore::new(home.path())
            .load()
            .unwrap()
            .domain
            .as_deref(),
        Some("me.ngrok.app")
    );
    // the old location is not read: a file there changes nothing
    drop(s);
    let other = self::home();
    std::fs::create_dir_all(other.path().join("monitor")).unwrap();
    std::fs::write(
        other.path().join("monitor/config.json"),
        r#"{"formatVersion":1,"revision":5,"enabled":true,"domain":"old.ngrok.app"}"#,
    )
    .unwrap();
    let s = Server::start(other.path(), Opts::default());
    assert_eq!(s.get()["revision"], 0);
    assert_eq!(s.get()["settings"]["domain"], Value::Null);
}

#[test]
fn a_settings_file_written_for_the_google_sign_in_is_unreadable_and_can_be_replaced() {
    let home = home();
    std::fs::create_dir_all(home.path().join(".internal")).unwrap();
    std::fs::write(
        home.path().join(".internal/monitor-connection.json"),
        r#"{"formatVersion":1,"revision":3,"enabled":true,"allowEmails":["a@x.com"],"domain":null,"oauthApp":"managed"}"#,
    )
    .unwrap();
    let s = Server::start(
        home.path(),
        Opts {
            env_token: true,
            ..Opts::default()
        },
    );
    // Not started with half-understood settings; the PC says so and can start over.
    let v = s.get();
    assert_eq!(v["status"], "failed");
    assert_eq!(v["failure"], "config_unreadable");
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
    assert_eq!(s.put(true, None, 0).status, 200);
    assert_eq!(s.get()["failure"], Value::Null);
}

#[test]
fn a_token_is_saved_to_the_keychain_only_when_asked() {
    let home = home();
    let vault = FakeVault::new(None, true);
    let s = Server::start(
        home.path(),
        Opts {
            vault: vault.clone(),
            ..Opts::default()
        },
    );
    assert_eq!(s.put(true, None, 0).status, 200);
    // default: not saved
    assert_eq!(s.start_ngrok(json!({"token": TOKEN})).status, 202);
    assert_eq!(vault.saved(), None);
    let v = s.wait_status("ready");
    assert_eq!(v["tokenSource"], "session");
    assert_eq!(v["keychainTokenSaved"], false);
    assert_eq!(s.stop_ngrok().status, 200);
    // save: true stores it and reports the keychain as the source
    let r = s.start_ngrok(json!({"token": TOKEN, "save": true}));
    assert_eq!(r.status, 202, "{}", r.body);
    assert_eq!(vault.saved().as_deref(), Some(TOKEN));
    assert_eq!(r.json()["tokenSource"], "keychain");
    assert_eq!(r.json()["keychainTokenSaved"], true);
    assert!(!r.body.contains(TOKEN));
    s.wait_status("ready");
    // never on disk, in GET or in PUT
    assert!(!all_files_text(home.path()).contains(TOKEN));
    assert!(!s.get().to_string().contains(TOKEN));
    assert!(!s.put(true, None, 2).body.contains(TOKEN));
    // save without a token is a bad request
    assert_eq!(s.start_ngrok(json!({"save": true})).status, 422);
}

#[test]
fn a_saved_token_is_found_at_the_next_run_and_the_environment_wins() {
    // keychain only
    let home1 = home();
    let vault = FakeVault::new(Some(SAVED), true);
    let s = Server::start(
        home1.path(),
        Opts {
            vault: vault.clone(),
            ..Opts::default()
        },
    );
    let v = s.get();
    assert_eq!(v["tokenConfigured"], true);
    assert_eq!(v["tokenSource"], "keychain");
    assert_eq!(v["keychainTokenSaved"], true);
    assert_eq!(s.put(false, None, 0).status, 200);
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    s.wait_status("ready");
    assert_eq!(s.fake.calls.lock().unwrap()[0].token, SAVED);
    drop(s);
    // environment and keychain both: the environment is used
    let home2 = home();
    let s = Server::start(
        home2.path(),
        Opts {
            vault: FakeVault::new(Some(SAVED), true),
            env_token: true,
            ..Opts::default()
        },
    );
    let v = s.get();
    assert_eq!(v["tokenSource"], "env");
    assert_eq!(v["keychainTokenSaved"], true);
    assert_eq!(s.put(false, None, 0).status, 200);
    assert_eq!(s.start_ngrok(json!({})).status, 202);
    s.wait_status("ready");
    assert_eq!(s.fake.calls.lock().unwrap()[0].token, TOKEN);
}

#[test]
fn a_saved_token_restores_an_enabled_connection_at_startup() {
    let home = home();
    ConfigStore::new(home.path())
        .save(&ConnectionConfig {
            enabled: true,
            domain: None,
            revision: 1,
        })
        .unwrap();
    let s = Server::start(
        home.path(),
        Opts {
            vault: FakeVault::new(Some(SAVED), true),
            ..Opts::default()
        },
    );
    s.wait_status("ready");
    assert_eq!(s.fake.calls.lock().unwrap()[0].token, SAVED);
}

#[test]
fn a_saved_token_can_be_deleted_and_is_then_forgotten() {
    let home = home();
    let vault = FakeVault::new(Some(SAVED), true);
    let s = Server::start(
        home.path(),
        Opts {
            vault: vault.clone(),
            ..Opts::default()
        },
    );
    assert_eq!(s.get()["tokenSource"], "keychain");
    let r = s.write("DELETE", "/api/monitor-connections/token", &json!({}));
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(vault.saved(), None);
    assert_eq!(r.json()["tokenConfigured"], false);
    assert_eq!(r.json()["tokenSource"], Value::Null);
    assert_eq!(r.json()["keychainTokenSaved"], false);
    assert_eq!(s.start_ngrok(json!({})).status, 422);
    // deleting again is fine; a delete is a guarded write
    assert_eq!(
        s.write("DELETE", "/api/monitor-connections/token", &json!({}))
            .status,
        200
    );
    assert_eq!(
        request(s.local, "DELETE", "/api/monitor-connections/token", &[], "").status,
        403
    );
}

#[test]
fn deleting_keeps_the_environment_token() {
    let home = home();
    let s = Server::start(
        home.path(),
        Opts {
            vault: FakeVault::new(Some(SAVED), true),
            env_token: true,
            ..Opts::default()
        },
    );
    let r = s.write("DELETE", "/api/monitor-connections/token", &json!({}));
    assert_eq!(r.status, 200);
    assert_eq!(r.json()["tokenSource"], "env");
    assert_eq!(r.json()["keychainTokenSaved"], false);
}

#[test]
fn without_a_keychain_saving_is_refused_with_a_fixed_code_and_nothing_starts() {
    let home = home();
    let vault = FakeVault::new(None, false);
    let s = Server::start(
        home.path(),
        Opts {
            vault: vault.clone(),
            ..Opts::default()
        },
    );
    assert_eq!(s.put(true, None, 0).status, 200);
    let v = s.get();
    assert_eq!(v["keychainAvailable"], false);
    let r = s.start_ngrok(json!({"token": TOKEN, "save": true}));
    assert_eq!(r.status, 409, "{}", r.body);
    assert_eq!(r.json()["error"]["code"], "keychain_unavailable");
    assert!(!r.body.contains(TOKEN));
    assert_eq!(s.fake.opens.load(Ordering::SeqCst), 0);
    assert_eq!(s.get()["tokenConfigured"], false);
    assert_eq!(s.get()["revision"], 1);
    // entering the token each time still works
    assert_eq!(s.start_ngrok(json!({"token": TOKEN})).status, 202);
    s.wait_status("ready");
    // and a delete says the keychain is not there
    let r = s.write("DELETE", "/api/monitor-connections/token", &json!({}));
    assert_eq!(r.status, 409);
    assert_eq!(r.json()["error"]["code"], "keychain_unavailable");
}

#[test]
fn a_run_that_never_needs_a_token_does_not_read_the_keychain() {
    let home = home();
    let vault = FakeVault::new(Some(SAVED), true);
    let s = Server::start(
        home.path(),
        Opts {
            vault: vault.clone(),
            ..Opts::default()
        },
    );
    assert_eq!(
        request(s.local, "GET", "/api/projects", &[], "").status,
        200
    );
    assert_eq!(vault.loads.load(Ordering::SeqCst), 0);
}
