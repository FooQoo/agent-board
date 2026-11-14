//! Waiting for the answers to one request. The board is read only when the server reports a
//! change; the heartbeat is a timer and never reads the board.

use std::cell::Cell;
use std::path::Path;
use std::time::Duration;

use crate::agent::wait_engine::{Evaluation, WaitReader, WaitResult, wait_until};
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::qa::{QaRequestFile, RequestStatus, read_request};
use crate::file_store::reader;

/// How a wait for a request ended.
pub enum QaWaitEnd {
    /// Every question has an answer.
    Answered(QaRequestFile),
    /// The request was withdrawn.
    Withdrawn(QaRequestFile),
    /// The time ran out; the request stays open.
    Timeout(QaRequestFile),
}

/// What a heartbeat reports: the seconds waited, the seconds left (`None` without a limit),
/// and the answers counted at the last read.
pub struct Heartbeat {
    pub elapsed: u64,
    pub remaining: Option<u64>,
    pub answered: usize,
    pub total: usize,
}

struct RequestReader<'a> {
    shared: &'a Path,
    project: ProjectId,
    request_id: &'a str,
}

impl WaitReader for RequestReader<'_> {
    type Snapshot = QaRequestFile;

    fn read(&self) -> Result<Self::Snapshot, AgboardError> {
        let project_dir = reader::project_dir_checked(self.shared, &self.project)?;
        read_request(self.shared, &project_dir, self.request_id)
    }

    fn project(&self) -> &ProjectId {
        &self.project
    }
}

/// Wait until request `request_id` is answered or withdrawn, or `timeout_secs` pass.
/// `tick` is called every `heartbeat_secs` while the wait goes on.
pub fn wait_for_request(
    shared: &Path,
    project: ProjectId,
    request_id: &str,
    timeout_secs: Option<u64>,
    heartbeat_secs: u64,
    mut tick: impl FnMut(Heartbeat),
) -> Result<QaWaitEnd, AgboardError> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| AgboardError::BoardUnavailable {
            reason: error.to_string(),
        })?;
    let reader = RequestReader {
        shared,
        project,
        request_id,
    };
    let counts = Cell::new((0usize, 0usize));
    runtime.block_on(async {
        let start = tokio::time::Instant::now();
        let deadline = timeout_secs.map(|seconds| start + Duration::from_secs(seconds));
        let waiting = wait_until(shared, &reader, deadline, |request: &QaRequestFile| {
            counts.set((request.answered_count(), request.questions.len()));
            Ok(match request.status() {
                RequestStatus::Answered => Evaluation::Ready(QaWaitEnd::Answered(request.clone())),
                RequestStatus::Withdrawn => {
                    Evaluation::Ready(QaWaitEnd::Withdrawn(request.clone()))
                }
                RequestStatus::Open => Evaluation::Continue,
            })
        });
        tokio::pin!(waiting);
        let every = Duration::from_secs(heartbeat_secs.max(1));
        let mut ticker = tokio::time::interval_at(start + every, every);
        loop {
            tokio::select! {
                result = &mut waiting => {
                    return match result? {
                        WaitResult::Satisfied(end) => Ok(end),
                        WaitResult::DeadlineReached(request) => Ok(QaWaitEnd::Timeout(request)),
                    };
                }
                _ = ticker.tick() => {
                    let elapsed = start.elapsed().as_secs();
                    let (answered, total) = counts.get();
                    tick(Heartbeat {
                        elapsed,
                        remaining: timeout_secs.map(|limit| limit.saturating_sub(elapsed)),
                        answered,
                        total,
                    });
                }
            }
        }
    })
}
