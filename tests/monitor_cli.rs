use std::ffi::OsString;

use agent_board::cli::args::{Command, Parsed, parse};

fn parse_args(args: &[&str]) -> Result<Parsed, agent_board::error::AgboardError> {
    let mut full = vec![OsString::from("agboard")];
    full.extend(args.iter().map(OsString::from));
    parse(&full)
}

#[test]
fn the_removed_remote_listener_arguments_are_rejected_as_unknown_arguments() {
    let Parsed::Run(defaults) = parse_args(&["serve"]).unwrap() else {
        panic!()
    };
    defaults.validate().unwrap();
    assert!(matches!(defaults.command, Command::Serve(_)));

    for argv in [
        vec!["serve", "--remote-port", "8001"],
        vec!["serve", "--remote-origin", "https://board.example"],
        vec![
            "serve",
            "--remote-port",
            "8001",
            "--remote-origin",
            "https://board.example",
        ],
        vec![
            "serve",
            "--monitor",
            "ngrok",
            "--ngrok-allow-email",
            "me@example.com",
            "--remote-port",
            "8001",
        ],
    ] {
        match parse_args(&argv) {
            Err(error) => {
                assert_eq!(error.exit_code(), 2, "{argv:?}");
                assert!(error.message().contains("--remote"), "{argv:?}");
            }
            Ok(_) => panic!("accepted a removed argument: {argv:?}"),
        }
    }
}
