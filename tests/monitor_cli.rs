use std::ffi::OsString;
use std::net::TcpListener;
use std::sync::Mutex;

use agent_board::cli::args::{Command, Parsed, parse};

fn parse_args(args: &[&str]) -> Result<Parsed, agent_board::error::AgboardError> {
    let mut full = vec![OsString::from("agboard")];
    full.extend(args.iter().map(OsString::from));
    parse(&full)
}

#[test]
fn remote_listener_arguments_are_opt_in_and_require_a_port_and_https_origins() {
    let Parsed::Run(defaults) = parse_args(&["serve"]).unwrap() else {
        panic!()
    };
    defaults.validate().unwrap();
    let Command::Serve(args) = defaults.command else {
        panic!()
    };
    assert_eq!(args.remote_port, None);
    assert!(args.remote_origins.is_empty());

    for argv in [
        vec!["serve", "--remote-port", "8001"],
        vec!["serve", "--remote-origin", "https://board.example"],
        vec![
            "serve",
            "--port",
            "8001",
            "--remote-port",
            "8001",
            "--remote-origin",
            "https://board.example",
        ],
        vec![
            "serve",
            "--remote-port",
            "8001",
            "--remote-origin",
            "http://board.example",
        ],
        vec![
            "serve",
            "--remote-port",
            "8001",
            "--remote-origin",
            "https://board.example/path",
        ],
        vec![
            "serve",
            "--remote-port",
            "8001",
            "--remote-origin",
            "https://user@board.example",
        ],
    ] {
        let parsed = parse_args(&argv).unwrap();
        let Parsed::Run(cli) = parsed else { panic!() };
        assert!(
            cli.validate().is_err(),
            "accepted invalid arguments: {argv:?}"
        );
    }

    let Parsed::Run(cli) = parse_args(&[
        "serve",
        "--port",
        "8000",
        "--remote-port",
        "8001",
        "--remote-origin",
        "https://board.example",
        "--remote-origin",
        "https://tail.example:8443",
    ])
    .unwrap() else {
        panic!()
    };
    cli.validate().unwrap();
    let Command::Serve(args) = cli.command else {
        panic!()
    };
    assert_eq!(args.remote_port, Some(8001));
    assert_eq!(
        args.remote_origins,
        ["https://board.example", "https://tail.example:8443"]
    );
}

#[test]
fn a_failed_remote_bind_leaves_no_partial_serve_record() {
    static ENV_LOCK: Mutex<()> = Mutex::new(());
    let _lock = ENV_LOCK.lock().unwrap();
    let home = tempfile::tempdir().unwrap();
    let occupied = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let remote_port = occupied.local_addr().unwrap().port();
    unsafe { std::env::set_var("AGBOARD_HOME", home.path()) };
    let result = agent_board::server::run_until_with_remote(
        agent_board::server::ServeConfig { port: 0 },
        Some(agent_board::server::RemoteServeConfig {
            port: remote_port,
            origins: vec!["https://board.example".into()],
        }),
        std::future::pending(),
        |_, _| panic!("on_ready must not run when a listener bind fails"),
    );
    unsafe { std::env::remove_var("AGBOARD_HOME") };
    assert!(
        matches!(result, Err(agent_board::error::AgboardError::PortInUse { port }) if port == remote_port)
    );
    assert!(!home.path().join("serve.json").exists());
}
