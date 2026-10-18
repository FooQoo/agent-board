//! Shared event-driven wait engine for fixed project identities.
//!
//! Callers provide a reader and a predicate. The engine checks before
//! subscribing, checks again after the stream's `ready` event, and checks on
//! every `changed` event. A single monotonic deadline is retained across the
//! whole operation; timeout performs one final read before returning.

use std::path::Path;
use std::time::Duration;

use eventsource_stream::Eventsource;
use futures_util::StreamExt;

use crate::{error::AgboardError, paths};

const CONNECT_LIMIT: Duration = Duration::from_secs(3);

#[derive(serde::Deserialize)]
struct Health {
    ok: bool,
    pid: u32,
}

/// A source that keeps reading exactly one project after its name is resolved.
pub(crate) trait WaitReader {
    type Snapshot;

    fn read(&self) -> Result<Self::Snapshot, AgboardError>;
}

/// Result of applying a wait's purpose-specific predicate to a snapshot.
pub(crate) enum Evaluation<T> {
    Ready(T),
    Continue,
}

/// The engine's two ordinary endings. Errors remain errors and are never
/// converted into a timeout.
pub(crate) enum WaitResult<T, S> {
    Satisfied(T),
    DeadlineReached(S),
}

fn unavailable(reason: impl Into<String>) -> AgboardError {
    AgboardError::BoardUnavailable {
        reason: reason.into(),
    }
}

fn remaining(deadline: Option<tokio::time::Instant>) -> Option<Duration> {
    deadline.map(|at| at.saturating_duration_since(tokio::time::Instant::now()))
}

fn connect_budget(deadline: Option<tokio::time::Instant>) -> Duration {
    remaining(deadline).map_or(CONNECT_LIMIT, |left| left.min(CONNECT_LIMIT))
}

async fn final_read<R, T, F>(
    reader: &R,
    evaluate: &mut F,
) -> Result<WaitResult<T, R::Snapshot>, AgboardError>
where
    R: WaitReader,
    F: FnMut(&R::Snapshot) -> Result<Evaluation<T>, AgboardError>,
{
    let snapshot = reader.read()?;
    match evaluate(&snapshot)? {
        Evaluation::Ready(value) => Ok(WaitResult::Satisfied(value)),
        Evaluation::Continue => Ok(WaitResult::DeadlineReached(snapshot)),
    }
}

/// Evaluate a condition against one fixed project's snapshots and wait for
/// server events until it becomes true or the absolute deadline is reached.
///
/// This function never polls: reads happen initially, after `ready`, after
/// `changed`, and once more at the deadline. Health and stream connections are
/// bounded by both three seconds and the remaining lifetime. The health body
/// is included in that bound as well.
pub(crate) async fn wait_until<R, T, F>(
    shared: &Path,
    reader: &R,
    deadline: Option<tokio::time::Instant>,
    mut evaluate: F,
) -> Result<WaitResult<T, R::Snapshot>, AgboardError>
where
    R: WaitReader,
    F: FnMut(&R::Snapshot) -> Result<Evaluation<T>, AgboardError>,
{
    let first = reader.read()?;
    if let Evaluation::Ready(value) = evaluate(&first)? {
        return Ok(WaitResult::Satisfied(value));
    }
    if remaining(deadline).is_some_and(|left| left.is_zero()) {
        return final_read(reader, &mut evaluate).await;
    }

    // The data area contains both the shared folder and serve.json.
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

    let budget = connect_budget(deadline);
    if budget.is_zero() {
        return final_read(reader, &mut evaluate).await;
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
        Ok(Err(error))
            if error.is_timeout() && remaining(deadline).is_some_and(|d| d.is_zero()) =>
        {
            return final_read(reader, &mut evaluate).await;
        }
        Ok(Err(error)) => {
            return Err(unavailable(format!(
                "serve.json names the server on port {}, which does not answer ({error}). The server may have stopped; run \"agboard serve\" again.",
                info.port
            )));
        }
        Err(_) if remaining(deadline).is_some_and(|d| d.is_zero()) => {
            return final_read(reader, &mut evaluate).await;
        }
        Err(_) => return Err(unavailable("The server health check timed out.")),
    };
    let body_budget = connect_budget(deadline);
    if body_budget.is_zero() {
        return final_read(reader, &mut evaluate).await;
    }
    let health: Health = match tokio::time::timeout(body_budget, health_response.json()).await {
        Ok(Ok(health)) => health,
        Ok(Err(error)) => return Err(unavailable(error.to_string())),
        Err(_) if remaining(deadline).is_some_and(|d| d.is_zero()) => {
            return final_read(reader, &mut evaluate).await;
        }
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
        return final_read(reader, &mut evaluate).await;
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
        Ok(Err(error))
            if error.is_timeout() && remaining(deadline).is_some_and(|d| d.is_zero()) =>
        {
            return final_read(reader, &mut evaluate).await;
        }
        Ok(Err(error)) => return Err(unavailable(error.to_string())),
        Err(_) if remaining(deadline).is_some_and(|d| d.is_zero()) => {
            return final_read(reader, &mut evaluate).await;
        }
        Err(_) => return Err(unavailable("The event stream connection timed out.")),
    };

    let mut events = response.bytes_stream().eventsource();
    let mut ready = false;
    loop {
        let next = match remaining(deadline) {
            Some(left) if left.is_zero() => return final_read(reader, &mut evaluate).await,
            Some(left) => match tokio::time::timeout(left, events.next()).await {
                Ok(next) => next,
                Err(_) => return final_read(reader, &mut evaluate).await,
            },
            None => events.next().await,
        };
        let event = match next {
            Some(Ok(event)) => event,
            Some(Err(error)) => {
                return Err(unavailable(format!("The event stream failed: {error}")));
            }
            None => return Err(unavailable("The event stream was disconnected.")),
        };
        if event.event == "ready" {
            ready = true;
        }
        if ready && (event.event == "ready" || event.event == "changed") {
            let snapshot = reader.read()?;
            if let Evaluation::Ready(value) = evaluate(&snapshot)? {
                return Ok(WaitResult::Satisfied(value));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct SequenceReader(AtomicUsize);

    impl WaitReader for SequenceReader {
        type Snapshot = usize;

        fn read(&self) -> Result<Self::Snapshot, AgboardError> {
            Ok(self.0.fetch_add(1, Ordering::SeqCst))
        }
    }

    #[tokio::test]
    async fn an_already_satisfied_condition_does_not_need_a_server() {
        let reader = SequenceReader(AtomicUsize::new(7));
        let result = wait_until(Path::new("/missing"), &reader, None, |snapshot| {
            Ok(Evaluation::Ready(*snapshot))
        })
        .await
        .unwrap();

        assert!(matches!(result, WaitResult::Satisfied(7)));
        assert_eq!(reader.0.load(Ordering::SeqCst), 8);
    }

    #[tokio::test]
    async fn deadline_rechecks_once_and_accepts_a_condition_arriving_at_the_boundary() {
        let reader = SequenceReader(AtomicUsize::new(0));
        let deadline = tokio::time::Instant::now();
        let result = wait_until(Path::new("/missing"), &reader, Some(deadline), |snapshot| {
            if *snapshot == 1 {
                Ok(Evaluation::Ready(*snapshot))
            } else {
                Ok(Evaluation::Continue)
            }
        })
        .await
        .unwrap();

        assert!(matches!(result, WaitResult::Satisfied(1)));
        assert_eq!(reader.0.load(Ordering::SeqCst), 2);
    }
}
