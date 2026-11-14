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

use super::wait_connect::{Connected, connect};
use crate::domain::ProjectId;
use crate::error::AgboardError;

/// A source that keeps reading exactly one project after its name is resolved.
pub(crate) trait WaitReader {
    type Snapshot;

    fn read(&self) -> Result<Self::Snapshot, AgboardError>;

    /// The project followed, whose board a server started for the wait opens.
    fn project(&self) -> &ProjectId;
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
    // A server that stops between reading serve.json and connecting is
    // started again once.
    let mut retried = false;
    let response = loop {
        if crate::autostart::enabled() {
            crate::autostart::ensure_serving(dir, Some(reader.project()))?;
        }
        match connect(dir, deadline).await {
            Ok(Connected::Stream(response)) => break response,
            Ok(Connected::DeadlineReached) => return final_read(reader, &mut evaluate).await,
            Err(AgboardError::BoardUnavailable { .. })
                if !retried && crate::autostart::enabled() =>
            {
                retried = true;
            }
            Err(error) => return Err(error),
        }
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

    fn project() -> ProjectId {
        "0123456789abcdef0123456789abcdef".parse().unwrap()
    }

    struct SequenceReader(AtomicUsize, ProjectId);

    impl WaitReader for SequenceReader {
        type Snapshot = usize;

        fn read(&self) -> Result<Self::Snapshot, AgboardError> {
            Ok(self.0.fetch_add(1, Ordering::SeqCst))
        }

        fn project(&self) -> &ProjectId {
            &self.1
        }
    }

    #[tokio::test]
    async fn an_already_satisfied_condition_does_not_need_a_server() {
        let reader = SequenceReader(AtomicUsize::new(7), project());
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
        let reader = SequenceReader(AtomicUsize::new(0), project());
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
