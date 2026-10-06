//! Wait for an SSE board-change event, then return one complete read-only snapshot.

use crate::{
    clock::{Clock, SystemClock, format_utc},
    domain::{ChangeCursor, FetchedSnapshot, ProjectId, validate_project_name},
    error::SkanError,
    paths,
    store::ProjectStore,
};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use std::time::{Duration, Instant};

#[derive(serde::Deserialize)]
struct Health {
    ok: bool,
    pid: u32,
}

/// Why a read of the project failed, with the code the CLI reports.
fn unavailable(error: &SkanError) -> String {
    match error {
        SkanError::ProjectNotFound { .. } => format!("project_not_found: {}", error.reason()),
        other => format!("board_unavailable: {other}"),
    }
}

/// Resolve `name` to the project's ID and check that the cursor belongs to it.
/// The ID found here is the one the whole wait uses.
fn resolve_project(name: &str, cursor: &ChangeCursor) -> Result<ProjectId, String> {
    let name = validate_project_name(name).map_err(|e| format!("invalid_value: {}", e.reason()))?;
    let path = paths::db_path();
    if !path.exists() {
        return Err("board_unavailable: board database does not exist".into());
    }
    let store = ProjectStore::open_read_only(&path).map_err(|e| unavailable(&e))?;
    let id = store
        .project_by_name(&name)
        .map_err(|e| unavailable(&e))?
        .id;
    if id != cursor.project_id {
        return Err("cursor_invalid: the cursor belongs to a different project".into());
    }
    Ok(id)
}

fn snapshot_json(project_id: &ProjectId) -> Result<(i64, String), String> {
    let path = paths::db_path();
    if !path.exists() {
        return Err("board_unavailable: board database does not exist".into());
    }
    let store = ProjectStore::open_read_only(&path).map_err(|e| unavailable(&e))?;
    let snapshot = store.snapshot(project_id).map_err(|e| unavailable(&e))?;
    let value = FetchedSnapshot {
        fetched_at: format_utc(SystemClock.now()),
        snapshot: &snapshot,
    };
    let json = serde_json::to_string(&value).map_err(|e| format!("board_unavailable: {e}"))?;
    Ok((snapshot.revision, json))
}

/// Wait for a change to the project named `project` after `cursor`. The
/// project is resolved to its ID here, once; a later rename does not matter and
/// a same-name re-creation is a different project.
pub async fn wait_for_change(
    project: &str,
    cursor: ChangeCursor,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    let began = Instant::now();
    let project_id = resolve_project(project, &cursor)?;
    let after = cursor.revision;
    if timeout_secs == Some(0) {
        return final_snapshot(&project_id, after);
    }
    let info = paths::read_serve_info()
        .ok_or_else(|| "board_unavailable: no running Agent Board server".to_owned())?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("board_unavailable: {e}"))?;
    let base = format!("http://127.0.0.1:{}", info.port);
    let connect_timeout = timeout_secs
        .map(|seconds| {
            Duration::from_secs(seconds)
                .saturating_sub(began.elapsed())
                .min(Duration::from_secs(3))
        })
        .unwrap_or(Duration::from_secs(3));
    if connect_timeout.is_zero() {
        return final_snapshot(&project_id, after);
    }
    let health: Health = client
        .get(format!("{base}/api/health"))
        .timeout(connect_timeout)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| {
            if e.is_timeout()
                && timeout_secs
                    .is_some_and(|seconds| began.elapsed() >= Duration::from_secs(seconds))
            {
                "wait_timeout: no board change before timeout".to_owned()
            } else {
                format!("board_unavailable: {e}")
            }
        })?
        .json()
        .await
        .map_err(|e| format!("board_unavailable: {e}"))?;
    if !health.ok || health.pid != info.pid {
        return Err("board_unavailable: server process did not match serve.json".into());
    }
    let connect_timeout = timeout_secs
        .map(|seconds| {
            Duration::from_secs(seconds)
                .saturating_sub(began.elapsed())
                .min(Duration::from_secs(3))
        })
        .unwrap_or(Duration::from_secs(3));
    if connect_timeout.is_zero() {
        return final_snapshot(&project_id, after);
    }
    // Bound connection establishment without applying a request timeout to the
    // response body: the SSE body is intentionally long-lived while we wait.
    let response = match tokio::time::timeout(
        connect_timeout,
        client
            .get(format!("{base}/api/events"))
            .header("Host", format!("127.0.0.1:{}", info.port))
            .send(),
    )
    .await
    {
        Ok(Ok(response)) => response
            .error_for_status()
            .map_err(|e| format!("board_unavailable: {e}"))?,
        Ok(Err(error)) => {
            if error.is_timeout()
                && timeout_secs
                    .is_some_and(|seconds| began.elapsed() >= Duration::from_secs(seconds))
            {
                return final_snapshot(&project_id, after);
            }
            return Err(format!("board_unavailable: {error}"));
        }
        Err(_) => {
            if timeout_secs.is_some_and(|seconds| began.elapsed() >= Duration::from_secs(seconds)) {
                return final_snapshot(&project_id, after);
            }
            return Err("board_unavailable: event stream connection timed out".into());
        }
    };
    let mut events = response.bytes_stream().eventsource();
    let mut ready = false;
    loop {
        let next = if let Some(seconds) = timeout_secs {
            let remaining = Duration::from_secs(seconds).saturating_sub(began.elapsed());
            if remaining.is_zero() {
                None
            } else {
                tokio::time::timeout(remaining, events.next())
                    .await
                    .ok()
                    .flatten()
            }
        } else {
            events.next().await
        };
        let Some(event) = next else {
            if timeout_secs.is_some() {
                return final_snapshot(&project_id, after);
            }
            return Err("board_unavailable: event stream disconnected".into());
        };
        let event = event.map_err(|e| format!("board_unavailable: invalid event stream: {e}"))?;
        if event.event == "ready" {
            ready = true;
        }
        if ready && (event.event == "ready" || event.event == "changed") {
            let (revision, json) = snapshot_json(&project_id)?;
            if revision > after {
                return Ok(json);
            }
            if revision < after {
                return Err("cursor_invalid: requested revision is newer than the board".into());
            }
        }
    }
}

fn final_snapshot(project_id: &ProjectId, after: i64) -> Result<String, String> {
    let (revision, json) = snapshot_json(project_id)?;
    if revision > after {
        return Ok(json);
    }
    if revision < after {
        return Err("cursor_invalid: requested revision is newer than the board".into());
    }
    Err("wait_timeout: no board change before timeout".into())
}
