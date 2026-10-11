//! Wait for a change to one project, then return one complete read-only
//! snapshot of it.
//!
//! The project name is resolved to an ID once, at the start. From then on only
//! that ID is read, so a rename keeps the wait on the same project, a deletion
//! ends it with `project_not_found`, and a project created later under the same
//! name is never followed.
//!
//! A cursor names a content version. A different version now is an answer at
//! once; the same version waits for the server's `changed` and reads again.

use std::path::Path;
use std::time::{Duration, Instant};

use eventsource_stream::Eventsource;
use futures_util::StreamExt;

use crate::{
    clock::{Clock, SystemClock, format_utc},
    domain::{ChangeCursor, ProjectId, validate_project_name},
    error::SkanError,
    file_store::{FileStore, reader::FetchedSnapshot},
    paths,
};

/// How long connecting to the server (health check, then event stream) may take.
const CONNECT_LIMIT: Duration = Duration::from_secs(3);

#[derive(serde::Deserialize)]
struct Health {
    ok: bool,
    pid: u32,
}

fn unavailable(reason: impl Into<String>) -> SkanError {
    SkanError::BoardUnavailable {
        reason: reason.into(),
    }
}

/// A failure to read the board. A project that is gone keeps its own error
/// (exit code 4); every other failure is "unavailable".
fn read_error(error: SkanError, name: &str) -> SkanError {
    match error {
        SkanError::ProjectNotFound { .. } => SkanError::ProjectNotFound {
            project: name.to_string(),
        },
        other => unavailable(format!("{} {}", other.message(), other.reason())),
    }
}

/// Reads of the one project with a fixed ID.
struct Reader<'a> {
    shared: &'a Path,
    name: &'a str,
    id: ProjectId,
}

impl Reader<'_> {
    /// The project's version and its complete snapshot as JSON, from one read.
    fn read(&self) -> Result<(String, String), SkanError> {
        let store = FileStore::open(self.shared);
        let snapshot = store
            .board(&self.id)
            .map_err(|error| read_error(error, self.name))?;
        let json = serde_json::to_string(&FetchedSnapshot {
            fetched_at: format_utc(SystemClock.now()),
            snapshot: &snapshot,
        })
        .map_err(|error| unavailable(error.to_string()))?;
        Ok((snapshot.version.clone(), json))
    }

    /// The snapshot when its version is not the cursor's; `None` when it still is.
    fn compare(&self, version: &str) -> Result<Option<String>, SkanError> {
        let (current, json) = self.read()?;
        Ok((current != version).then_some(json))
    }

    /// The last look when the time is up: a change that arrived is a success.
    fn last_look(&self, version: &str) -> Result<String, SkanError> {
        self.compare(version)?.ok_or(SkanError::WaitTimeout)
    }
}

/// Resolve `name` to its project, once, and check that the cursor belongs to it.
fn resolve(shared: &Path, name: &str, cursor: &ChangeCursor) -> Result<ProjectId, SkanError> {
    let name = validate_project_name(name)?;
    let id = FileStore::open(shared)
        .project_by_name(&name)
        .map_err(|error| read_error(error, &name))?
        .id;
    if id != cursor.project_id {
        return Err(SkanError::CursorInvalid {
            reason: "The cursor belongs to a different project. Use the cursor from a snapshot of this project."
                .into(),
        });
    }
    Ok(id)
}

/// Time left of an optional overall limit, capped at the connection limit.
fn connect_budget(began: Instant, timeout: Option<Duration>) -> Duration {
    match timeout {
        Some(total) => total.saturating_sub(began.elapsed()).min(CONNECT_LIMIT),
        None => CONNECT_LIMIT,
    }
}

fn expired(began: Instant, timeout: Option<Duration>) -> bool {
    timeout.is_some_and(|total| began.elapsed() >= total)
}

/// Wait for a change to the project named `project` after `cursor`, on the
/// board at `db_path` and the server that serves that same data directory.
///
/// Returns the project's latest complete snapshot as JSON. A timeout, a lost
/// connection and an invalid cursor are errors, never answers. Nothing is
/// written and no polling happens; the only repeated reads follow server events.
pub async fn wait_for_change(
    shared: &Path,
    project: &str,
    cursor: ChangeCursor,
    timeout_secs: Option<u64>,
) -> Result<String, SkanError> {
    let began = Instant::now();
    let timeout = timeout_secs.map(Duration::from_secs);
    let id = resolve(shared, project, &cursor)?;
    let reader = Reader {
        shared,
        name: project,
        id,
    };
    let after = cursor.version.as_str();
    if timeout == Some(Duration::ZERO) {
        return reader.last_look(after);
    }

    // The data area holds both the shared folder and serve.json.
    let dir = shared
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let info = paths::read_serve_info_in(dir).ok_or_else(|| {
        unavailable("No running Agent Board server was found. Run \"agboard serve\".")
    })?;
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_LIMIT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| unavailable(error.to_string()))?;
    let base = format!("http://127.0.0.1:{}", info.port);

    let budget = connect_budget(began, timeout);
    if budget.is_zero() {
        return reader.last_look(after);
    }
    let health = client
        .get(format!("{base}/api/health"))
        .timeout(budget)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status);
    let health: Health = match health {
        Ok(response) => response
            .json()
            .await
            .map_err(|error| unavailable(error.to_string()))?,
        Err(error) if error.is_timeout() && expired(began, timeout) => {
            return reader.last_look(after);
        }
        Err(error) => return Err(unavailable(error.to_string())),
    };
    if !health.ok || health.pid != info.pid {
        return Err(unavailable("The server process does not match serve.json."));
    }

    // Bound only the connection; the event stream itself stays open while we wait.
    let budget = connect_budget(began, timeout);
    if budget.is_zero() {
        return reader.last_look(after);
    }
    let connecting = tokio::time::timeout(
        budget,
        client
            .get(format!("{base}/api/events"))
            .header("Host", format!("127.0.0.1:{}", info.port))
            .send(),
    )
    .await;
    let response = match connecting {
        Ok(Ok(response)) => response
            .error_for_status()
            .map_err(|error| unavailable(error.to_string()))?,
        Ok(Err(error)) if error.is_timeout() && expired(began, timeout) => {
            return reader.last_look(after);
        }
        Ok(Err(error)) => return Err(unavailable(error.to_string())),
        Err(_) if expired(began, timeout) => return reader.last_look(after),
        Err(_) => return Err(unavailable("The event stream connection timed out.")),
    };

    let mut events = response.bytes_stream().eventsource();
    let mut ready = false;
    loop {
        let next = match timeout {
            Some(total) => {
                let remaining = total.saturating_sub(began.elapsed());
                if remaining.is_zero() {
                    return reader.last_look(after);
                }
                match tokio::time::timeout(remaining, events.next()).await {
                    Ok(next) => next,
                    // The time is up while the stream is still open.
                    Err(_) => return reader.last_look(after),
                }
            }
            None => events.next().await,
        };
        let event = match next {
            Some(Ok(event)) => event,
            Some(Err(error)) => {
                return Err(unavailable(format!("The event stream failed: {error}")));
            }
            // The server closed the stream. That is a lost connection, not a
            // timeout and not "no change".
            None => return Err(unavailable("The event stream was disconnected.")),
        };
        // Only events after `ready` are compared: the first read happens once
        // the subscription exists, so a change made before it is still seen.
        if event.event == "ready" {
            ready = true;
        }
        if ready
            && (event.event == "ready" || event.event == "changed")
            && let Some(json) = reader.compare(after)?
        {
            return Ok(json);
        }
    }
}
