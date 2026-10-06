//! Runs the web server on its own: `cargo run --example serve -- --port <PORT>`.
//!
//! The data directory is `SKAN_HOME`. A new one is served with no projects.
//! Stop with Ctrl+C.

use std::process::ExitCode;

use agent_board::server::{ServeConfig, run};

fn parse_port(args: &[String]) -> Result<u16, String> {
    match args {
        [flag, value] if flag == "--port" => {
            value.parse().map_err(|_| format!("invalid port: {value}"))
        }
        _ => Err("usage: serve --port <PORT>".to_string()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let port = match parse_port(&args) {
        Ok(port) => port,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    println!("Serving http://127.0.0.1:{port}/ (Ctrl+C to stop)");
    match run(ServeConfig { port }) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Error: {}", error.message());
            eprintln!("Reason: {}", error.reason());
            ExitCode::from(u8::try_from(error.exit_code()).unwrap_or(1))
        }
    }
}
