//! `agboard show remote`: the saved ngrok settings, the connection state, and, with a project,
//! the public address of the board and the 4-digit passcode, so that an agent can hand the user
//! a link to open the board on a phone.
//!
//! The running server is found through `serve.json` and asked on its loopback
//! address, as `agboard open` finds it. The server answers
//! `GET /api/monitor-connections` on the local router only, so the passcode
//! goes to the person at this computer and never through the tunnel. Nothing
//! is started here.
//!
//! - With a project, the command is what the old `agboard remote` was: only a ready connection with
//!   an address and a passcode gives an outcome, anything else is `remote_unavailable`. The
//!   outcome also carries the saved settings.
//! - Without a project it reports the saved settings and whatever state the connection is
//!   in, and never fails because the connection is down. It prints no passcode.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::Path;
use std::time::Duration;

use serde_json::{Value, json};

use crate::cli::Outcome;
use crate::error::AgboardError;
use crate::remote_settings::{self as saved, Saved};
use crate::server::monitor_connection::keychain::TokenVault;

/// How long the server gets to answer, in total for each step.
const TIMEOUT: Duration = Duration::from_secs(3);
/// The status carries no secret but the passcode and is small.
const MAX_REPLY: usize = 64 * 1024;

pub fn run(
    data_dir: &Path,
    project: Option<(String, String)>,
    vault: &dyn TokenVault,
) -> Result<Outcome, AgboardError> {
    let settings = saved::read(data_dir, vault)?;
    let info = crate::paths::read_serve_info_in(data_dir).filter(crate::server::is_serving);
    let Some(project) = project else {
        let status = info.map(|info| fetch_status(info.port));
        return Ok(overview(&settings, status));
    };
    let info = info.ok_or_else(|| {
        unavailable(
            "No server is running, so there is no ngrok connection. Start one with \"agboard serve\" and turn the connection on in the board's settings, or with \"NGROK_AUTHTOKEN=... agboard serve --monitor ngrok\".",
        )
    })?;
    let status = fetch_status(info.port)?;
    let mut outcome = build(&status, project)?;
    outcome.human.push_str(&settings.human());
    for (key, value) in settings.to_json().as_object().into_iter().flatten() {
        outcome.json[key] = value.clone();
    }
    Ok(outcome)
}

/// The saved settings and the state of the connection, for a run with no project. A server that
/// is not running, or that did not answer, is a state to report, not an error.
fn overview(settings: &Saved, status: Option<Result<Value, AgboardError>>) -> Outcome {
    let (state, entrance) = match &status {
        None => ("no_server", None),
        Some(Err(_)) => ("unknown", None),
        Some(Ok(status)) => (
            status["status"].as_str().unwrap_or("unknown"),
            status["url"]
                .as_str()
                .map(|url| url.trim_end_matches('/'))
                .filter(|url| {
                    state_is_ready(status)
                        && url.starts_with("https://")
                        && !url.contains(['?', '#'])
                }),
        ),
    };
    let mut json = settings.to_json();
    json["status"] = json!(state);
    json["entrance"] = json!(entrance);
    let connection = match (state, entrance) {
        ("no_server", _) => "no server is running".to_string(),
        (state, Some(url)) => format!("{state} at {url}"),
        (state, None) => state.to_string(),
    };
    Outcome {
        changed: false,
        human: format!("{}Connection: {connection}\n", settings.human()),
        json,
    }
}

fn state_is_ready(status: &Value) -> bool {
    status["status"].as_str() == Some("ready")
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
        " Start it with \"NGROK_AUTHTOKEN=... agboard serve --monitor ngrok\" or from the board's connection settings, and run this again once it is ready. \"agboard show remote\" without --project shows the saved settings.",
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
