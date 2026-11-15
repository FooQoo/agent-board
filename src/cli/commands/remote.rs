//! `agboard remote`: the ngrok connection state, the public address of the
//! board, and the 4-digit passcode, so that an agent can hand the user a link
//! to open the board on a phone.
//!
//! The running server is found through `serve.json` and asked on its loopback
//! address, as `agboard open` finds it. The server answers
//! `GET /api/monitor-connections` on the local router only, so the passcode
//! goes to the person at this computer and never through the tunnel. Nothing
//! is started here: without a ready connection there is no address and no
//! passcode to print.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

use serde_json::{Value, json};

use crate::cli::{Context, Outcome, Target};
use crate::error::AgboardError;

/// How long the server gets to answer, in total for each step.
const TIMEOUT: Duration = Duration::from_secs(3);
/// The status carries no secret but the passcode and is small.
const MAX_REPLY: usize = 64 * 1024;

pub fn run(ctx: &Context) -> Result<Outcome, AgboardError> {
    let dir = ctx
        .files
        .shared_dir()
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf();
    let info = crate::paths::read_serve_info_in(&dir)
        .filter(crate::server::is_serving)
        .ok_or_else(|| {
            unavailable(
                "No server is running, so there is no ngrok connection. Start one with \"NGROK_AUTHTOKEN=... agboard serve --monitor ngrok\", or turn the connection on in the board's settings.",
            )
        })?;
    // `--project` is required, so the target is always an existing project.
    let Target::Existing(meta) = &ctx.target else {
        return Err(AgboardError::InvalidArgument {
            message: "--project NAME is required.".to_string(),
            command: Some("remote".to_string()),
        });
    };
    let status = fetch_status(info.port)?;
    build(&status, (meta.id.to_string(), meta.name.clone()))
}

/// The outcome for the status the server returned. Only a ready connection
/// with an address and a passcode gives one; anything else is
/// `remote_unavailable`, with no address or passcode in the message.
fn build(status: &Value, (id, name): (String, String)) -> Result<Outcome, AgboardError> {
    let state = status["status"].as_str().unwrap_or("unknown");
    if state != "ready" {
        return Err(unavailable(&not_ready_reason(status, state)));
    }
    let entrance = status["url"]
        .as_str()
        .map(|url| url.trim_end_matches('/'))
        .filter(|url| url.starts_with("https://") && !url.contains(['?', '#']))
        .ok_or_else(|| unavailable("The ngrok connection is ready but has no public address yet. Try again in a moment."))?;
    let passcode = status["passcode"]
        .as_str()
        .filter(|code| !code.is_empty())
        .ok_or_else(|| {
            unavailable(
                "The ngrok connection is ready but has no passcode. Restart the connection.",
            )
        })?;

    let url = format!("{entrance}/?project={id}");
    Ok(Outcome {
        changed: false,
        human: format!("ngrok: {state}\nURL: {url}\nPasscode: {passcode}\nProject: {name}\n"),
        json: json!({
            "status": state,
            "url": url,
            "entrance": entrance,
            "passcode": passcode,
            "project": { "id": id, "name": name },
        }),
    })
}

fn not_ready_reason(status: &Value, state: &str) -> String {
    let mut reason = format!("The ngrok connection is not ready (status: {state}).");
    if let Some(failure) = status["failure"].as_str() {
        reason.push_str(&format!(" Failure: {failure}."));
    }
    reason.push_str(
        " Start it with \"NGROK_AUTHTOKEN=... agboard serve --monitor ngrok\" or from the board's connection settings, and run this again once it is ready.",
    );
    reason
}

fn unavailable(reason: &str) -> AgboardError {
    AgboardError::RemoteUnavailable {
        reason: reason.to_string(),
    }
}

/// `GET /api/monitor-connections` on the loopback address of the server.
fn fetch_status(port: u16) -> Result<Value, AgboardError> {
    let failed = |why: String| {
        unavailable(&format!(
            "The server on port {port} did not give its ngrok status: {why}."
        ))
    };
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream =
        TcpStream::connect_timeout(&addr, TIMEOUT).map_err(|e| failed(e.to_string()))?;
    stream
        .set_read_timeout(Some(TIMEOUT))
        .and_then(|()| stream.set_write_timeout(Some(TIMEOUT)))
        .map_err(|e| failed(e.to_string()))?;
    // HTTP/1.0 so that the body is not chunked and ends with the connection.
    let request = format!(
        "GET /api/monitor-connections HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| failed(e.to_string()))?;
    let mut reply = Vec::new();
    stream
        .take(MAX_REPLY as u64)
        .read_to_end(&mut reply)
        .map_err(|e| failed(e.to_string()))?;
    let text = String::from_utf8_lossy(&reply);
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| failed("the reply was incomplete".to_string()))?;
    let code = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("?");
    if code != "200" {
        return Err(failed(format!("it answered {code}")));
    }
    serde_json::from_str(body).map_err(|_| failed("the reply was not JSON".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demo() -> (String, String) {
        ("p1".into(), "Demo".into())
    }

    fn ready() -> Value {
        json!({"status":"ready","url":"https://abc.ngrok-free.app","passcode":"2418","failure":null})
    }

    #[test]
    fn a_ready_connection_gives_the_project_address_and_the_passcode() {
        let out = build(&ready(), demo()).unwrap();
        assert_eq!(
            out.json,
            json!({"status":"ready","url":"https://abc.ngrok-free.app/?project=p1","entrance":"https://abc.ngrok-free.app","passcode":"2418","project":{"id":"p1","name":"Demo"}})
        );
        assert_eq!(
            out.human,
            "ngrok: ready\nURL: https://abc.ngrok-free.app/?project=p1\nPasscode: 2418\nProject: Demo\n"
        );
    }

    #[test]
    fn a_connection_that_is_not_ready_prints_no_address_or_passcode() {
        for state in ["disabled", "starting", "reconnecting", "failed", "unknown"] {
            let status = json!({"status":state,"url":"https://abc.ngrok-free.app","passcode":"2418","failure":"connect_failed"});
            let error = build(&status, demo()).err().unwrap();
            let text = crate::cli::errors::human(&error);
            assert!(text.contains(state), "{text}");
            assert!(
                !text.contains("ngrok-free.app") && !text.contains("2418"),
                "{text}"
            );
        }
    }

    #[test]
    fn a_ready_status_without_an_address_or_a_passcode_is_unavailable() {
        for status in [
            json!({"status":"ready","passcode":"2418"}),
            json!({"status":"ready","url":"http://abc.example","passcode":"2418"}),
            json!({"status":"ready","url":"https://abc.ngrok-free.app"}),
        ] {
            assert!(matches!(
                build(&status, demo()),
                Err(AgboardError::RemoteUnavailable { .. })
            ));
        }
    }
}
