//! Wait for an SSE board-change event, then return one complete read-only snapshot.

use crate::{
    clock::{Clock, SystemClock, format_utc},
    paths,
    store::Store,
};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot<'a> {
    fetched_at: String,
    revision: i64,
    board: &'a crate::domain::BoardMeta,
    cards: &'a [crate::domain::Card],
}
#[derive(serde::Deserialize)]
struct Health {
    ok: bool,
    pid: u32,
}

fn snapshot_json() -> Result<(i64, String), String> {
    let path = paths::db_path();
    if !path.exists() {
        return Err("board_unavailable: board database does not exist".into());
    }
    let store = Store::open_read_only(&path).map_err(|e| format!("board_unavailable: {e}"))?;
    let snapshot = store
        .snapshot()
        .map_err(|e| format!("board_unavailable: {e}"))?;
    let value = Snapshot {
        fetched_at: format_utc(SystemClock.now()),
        revision: snapshot.revision,
        board: &snapshot.board,
        cards: &snapshot.cards,
    };
    let json = serde_json::to_string(&value).map_err(|e| format!("board_unavailable: {e}"))?;
    Ok((snapshot.revision, json))
}

pub async fn wait_for_change(after: i64, timeout_secs: Option<u64>) -> Result<String, String> {
    let began = Instant::now();
    if timeout_secs == Some(0) {
        return final_snapshot(after);
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
        return final_snapshot(after);
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
        return final_snapshot(after);
    }
    let response = client
        .get(format!("{base}/api/events"))
        .timeout(connect_timeout)
        .header("Host", format!("127.0.0.1:{}", info.port))
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
        })?;
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
                return final_snapshot(after);
            }
            return Err("board_unavailable: event stream disconnected".into());
        };
        let event = event.map_err(|e| format!("board_unavailable: invalid event stream: {e}"))?;
        if event.event == "ready" {
            ready = true;
        }
        if ready && (event.event == "ready" || event.event == "changed") {
            let (revision, json) = snapshot_json()?;
            if revision > after {
                return Ok(json);
            }
            if revision < after {
                return Err("cursor_invalid: requested revision is newer than the board".into());
            }
        }
    }
}

fn final_snapshot(after: i64) -> Result<String, String> {
    let (revision, json) = snapshot_json()?;
    if revision > after {
        return Ok(json);
    }
    if revision < after {
        return Err("cursor_invalid: requested revision is newer than the board".into());
    }
    Err("wait_timeout: no board change before timeout".into())
}
