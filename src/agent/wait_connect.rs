//! Reaching the server a wait listens to: read `serve.json`, check that the
//! process it names answers the health check, and open the event stream.
//! Every step is bounded by three seconds and by the wait's own deadline.

use std::path::Path;
use std::time::Duration;

use super::session_identity::SessionIdentity;
use crate::server::sessions;
use crate::{domain::ProjectId, error::AgboardError, paths};

const CONNECT_LIMIT: Duration = Duration::from_secs(3);

#[derive(serde::Deserialize)]
struct Health {
    ok: bool,
    pid: u32,
}

/// The outcome of a connection that did not fail.
pub(crate) enum Connected {
    /// The event stream is open.
    Stream(reqwest::Response),
    /// The deadline passed while connecting; the caller makes its final read.
    DeadlineReached,
}

fn unavailable(reason: impl Into<String>) -> AgboardError {
    AgboardError::BoardUnavailable {
        reason: reason.into(),
    }
}

fn remaining(deadline: Option<tokio::time::Instant>) -> Option<Duration> {
    deadline.map(|at| at.saturating_duration_since(tokio::time::Instant::now()))
}

fn past(deadline: Option<tokio::time::Instant>) -> bool {
    remaining(deadline).is_some_and(|left| left.is_zero())
}

fn connect_budget(deadline: Option<tokio::time::Instant>) -> Duration {
    remaining(deadline).map_or(CONNECT_LIMIT, |left| left.min(CONNECT_LIMIT))
}

/// A connection the OS or a sandbox refused is `local_network_denied`;
/// anything else is described by `otherwise`.
fn reach_error(
    error: reqwest::Error,
    otherwise: impl FnOnce(&reqwest::Error) -> AgboardError,
) -> AgboardError {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(&error);
    while let Some(current) = source {
        if let Some(io) = current.downcast_ref::<std::io::Error>()
            && crate::server::bind::is_denied(io)
        {
            return AgboardError::LocalNetworkDenied;
        }
        source = current.source();
    }
    otherwise(&error)
}

/// Open the event stream of the server that the `serve.json` in `dir` names.
pub(crate) async fn connect(
    dir: &Path,
    deadline: Option<tokio::time::Instant>,
    session: Option<(&ProjectId, &SessionIdentity)>,
) -> Result<Connected, AgboardError> {
    let info = paths::read_serve_info_in(dir).ok_or_else(|| {
        unavailable("No running Agent Board server was found. Run \"agboard serve\".")
    })?;
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_LIMIT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| unavailable(error.to_string()))?;
    let base = format!("http://127.0.0.1:{}", info.port);

    let budget = connect_budget(deadline);
    if budget.is_zero() {
        return Ok(Connected::DeadlineReached);
    }
    let health_response = tokio::time::timeout(
        budget,
        client
            .get(format!("{base}/api/health"))
            .timeout(budget)
            .send(),
    )
    .await;
    let health_response = match health_response {
        Ok(Ok(response)) => response
            .error_for_status()
            .map_err(|error| unavailable(error.to_string()))?,
        Ok(Err(error)) if error.is_timeout() && past(deadline) => {
            return Ok(Connected::DeadlineReached);
        }
        Ok(Err(error)) => {
            return Err(reach_error(error, |error| {
                unavailable(format!(
                    "serve.json names the server on port {}, which does not answer ({error}). The server may have stopped; run \"agboard serve\" again.",
                    info.port
                ))
            }));
        }
        Err(_) if past(deadline) => return Ok(Connected::DeadlineReached),
        Err(_) => return Err(unavailable("The server health check timed out.")),
    };
    let body_budget = connect_budget(deadline);
    if body_budget.is_zero() {
        return Ok(Connected::DeadlineReached);
    }
    let health: Health = match tokio::time::timeout(body_budget, health_response.json()).await {
        Ok(Ok(health)) => health,
        Ok(Err(error)) => return Err(unavailable(error.to_string())),
        Err(_) if past(deadline) => return Ok(Connected::DeadlineReached),
        Err(_) => return Err(unavailable("The server health response timed out.")),
    };
    if !health.ok || health.pid != info.pid {
        return Err(unavailable(format!(
            "serve.json names process {} on port {}, but that port is answered by another process. Run \"agboard serve\" again.",
            info.pid, info.port
        )));
    }

    let budget = connect_budget(deadline);
    if budget.is_zero() {
        return Ok(Connected::DeadlineReached);
    }
    let mut request = client
        .get(format!("{base}/api/events"))
        .header("Host", format!("127.0.0.1:{}", info.port))
        .header(crate::server::WAITING_COMMAND_HEADER, "1");
    if let Some((project, identity)) = session {
        request = request
            .header(sessions::SESSION_HEADER, &identity.key)
            .header(sessions::SESSION_TOOL_HEADER, identity.tool.as_str())
            .header(sessions::SESSION_ORIGIN_HEADER, identity.origin.as_str())
            .header(sessions::SESSION_PROJECT_HEADER, project.as_str());
    }
    let connecting = tokio::time::timeout(budget, request.send()).await;
    match connecting {
        Ok(Ok(response)) => response
            .error_for_status()
            .map(Connected::Stream)
            .map_err(|error| unavailable(error.to_string())),
        Ok(Err(error)) if error.is_timeout() && past(deadline) => Ok(Connected::DeadlineReached),
        Ok(Err(error)) => Err(reach_error(error, |error| unavailable(error.to_string()))),
        Err(_) if past(deadline) => Ok(Connected::DeadlineReached),
        Err(_) => Err(unavailable("The event stream connection timed out.")),
    }
}
