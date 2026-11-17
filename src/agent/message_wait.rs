//! Waiting for the answers to questions. The board is read only when the server reports a
//! change; the heartbeat is a timer and never reads the board.

use std::cell::Cell;
use std::path::Path;
use std::time::Duration;

use crate::agent::wait_engine::{Evaluation, WaitReader, WaitResult, wait_until};
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::qa::{Message, MessageState, Question, read_message};
use crate::file_store::reader;

/// How a wait for questions ended. Each carries the questions as they were last read.
pub enum MessageWaitEnd {
    /// Every question has an answer.
    Answered(Vec<Question>),
    /// No question is open any more, and some were withdrawn.
    Withdrawn(Vec<Question>),
    /// The time ran out; the open questions stay open.
    Timeout(Vec<Question>),
}

/// What a heartbeat reports: the seconds waited, the seconds left (`None` without a limit),
/// and the answers counted at the last read.
pub struct Heartbeat {
    pub elapsed: u64,
    pub remaining: Option<u64>,
    pub answered: usize,
    pub total: usize,
}

/// The questions named, read strictly. A request is not a question.
pub fn read_questions(
    shared: &Path,
    project: &ProjectId,
    ids: &[String],
) -> Result<Vec<Question>, AgboardError> {
    let project_dir = reader::project_dir_checked(shared, project)?;
    ids.iter()
        .map(|id| match read_message(shared, &project_dir, id)? {
            Message::Question(question) => Ok(question),
            Message::Request(_) => Err(AgboardError::MessageTypeMismatch {
                id: id.clone(),
                expected: "question".into(),
            }),
        })
        .collect()
}

struct QuestionReader<'a> {
    shared: &'a Path,
    project: ProjectId,
    ids: &'a [String],
}

impl WaitReader for QuestionReader<'_> {
    type Snapshot = Vec<Question>;

    fn read(&self) -> Result<Self::Snapshot, AgboardError> {
        read_questions(self.shared, &self.project, self.ids)
    }

    fn project(&self) -> &ProjectId {
        &self.project
    }
}

/// Wait until none of the questions `ids` is open, or `timeout_secs` pass. `tick` is called
/// every `heartbeat_secs` while the wait goes on.
pub fn wait_for_questions(
    shared: &Path,
    project: ProjectId,
    ids: &[String],
    timeout_secs: Option<u64>,
    heartbeat_secs: u64,
    mut tick: impl FnMut(Heartbeat),
) -> Result<MessageWaitEnd, AgboardError> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| AgboardError::BoardUnavailable {
            reason: error.to_string(),
        })?;
    let reader = QuestionReader {
        shared,
        project,
        ids,
    };
    let counts = Cell::new((0usize, 0usize));
    runtime.block_on(async {
        let start = tokio::time::Instant::now();
        let deadline = timeout_secs.map(|seconds| start + Duration::from_secs(seconds));
        let waiting = wait_until(shared, &reader, deadline, |questions: &Vec<Question>| {
            let count = |state: MessageState| questions.iter().filter(|q| q.state() == state).count();
            counts.set((count(MessageState::Closed), questions.len()));
            Ok(if count(MessageState::Open) > 0 {
                Evaluation::Continue
            } else if count(MessageState::Withdrawn) > 0 {
                Evaluation::Ready(MessageWaitEnd::Withdrawn(questions.clone()))
            } else {
                Evaluation::Ready(MessageWaitEnd::Answered(questions.clone()))
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
                        WaitResult::DeadlineReached(questions) => Ok(MessageWaitEnd::Timeout(questions)),
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
