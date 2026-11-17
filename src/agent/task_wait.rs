//! Wait for the next eligible AI task using the shared event-driven engine.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use crate::agent::wait_engine::{Evaluation, WaitReader, WaitResult, wait_until};
use crate::domain::{Assignee, Column, ProjectId, RunState, validate_project_name};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::layout;
use crate::file_store::model::TaskView;
use crate::file_store::reader::ProjectSnapshot;
use crate::progress::{ProgressAnswer, ProgressRequest, open_requests, unaccepted_answers};

struct Reader<'a> {
    shared: &'a Path,
    project_name: &'a str,
    project_id: ProjectId,
}

impl WaitReader for Reader<'_> {
    type Snapshot = ProjectSnapshot;

    fn read(&self) -> Result<Self::Snapshot, AgboardError> {
        let snapshot = FileStore::open(self.shared)
            .board(&self.project_id)
            .map_err(|error| match error {
                AgboardError::ProjectNotFound { .. } => AgboardError::ProjectNotFound {
                    project: self.project_name.to_string(),
                },
                other => AgboardError::BoardUnavailable {
                    reason: format!("{} {}", other.message(), other.reason()),
                },
            })?;
        if let Some(problem) = snapshot.problems.first() {
            return Err(AgboardError::BoardUnavailable {
                reason: format!("{} ({}): {}", problem.file, problem.field, problem.reason),
            });
        }
        Ok(snapshot)
    }

    fn project(&self) -> &ProjectId {
        &self.project_id
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskOutput {
    kind: &'static str,
    project_id: ProjectId,
    cursor: crate::domain::ChangeCursor,
    task: TaskView,
    task_path: std::path::PathBuf,
    document_path: Option<std::path::PathBuf>,
}

/// Answers a person gave that no agent accepted. The agent acts on them and records the receipt
/// with `message accept`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnswersOutput {
    kind: &'static str,
    project_id: ProjectId,
    cursor: crate::domain::ChangeCursor,
    answers: Vec<ProgressAnswer>,
}

/// Open requests from a person. The agent reads one with `message show` and takes it with
/// `message accept`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestsOutput {
    kind: &'static str,
    project_id: ProjectId,
    cursor: crate::domain::ChangeCursor,
    requests: Vec<ProgressRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdleTimeoutOutput {
    kind: &'static str,
    project_id: ProjectId,
    idle_timeout_seconds: u64,
}

/// Resolve the project name once, then track its immutable identity through
/// renames. The absolute monotonic deadline is created once and shared by all
/// notifications and the final snapshot check.
pub async fn wait_for_task(
    shared: &Path,
    project_name: &str,
    idle_timeout_seconds: u64,
) -> Result<String, AgboardError> {
    let project_name = validate_project_name(project_name)?;
    let project_id = FileStore::open(shared)
        .project_by_name(&project_name)
        .map_err(|error| match error {
            AgboardError::ProjectNotFound { .. } => AgboardError::ProjectNotFound {
                project: project_name.clone(),
            },
            other => AgboardError::BoardUnavailable {
                reason: format!("{} {}", other.message(), other.reason()),
            },
        })?
        .id;
    let reader = Reader {
        shared,
        project_name: &project_name,
        project_id: project_id.clone(),
    };

    // Work already on the board when listening starts is returned immediately.
    let initial = reader.read()?;
    if let Some(output) = ready(shared, &initial, &project_id)? {
        return Ok(output);
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(idle_timeout_seconds);
    match wait_until(shared, &reader, Some(deadline), |snapshot| {
        Ok(match ready(shared, snapshot, &project_id)? {
            Some(output) => Evaluation::Ready(output),
            None => Evaluation::Continue,
        })
    })
    .await?
    {
        WaitResult::Satisfied(output) => Ok(output),
        WaitResult::DeadlineReached(_) => serde_json::to_string(&IdleTimeoutOutput {
            kind: "idle_timeout",
            project_id,
            idle_timeout_seconds,
        })
        .map_err(|error| AgboardError::BoardUnavailable {
            reason: error.to_string(),
        }),
    }
}

/// What ends the wait: an answer no agent accepted first (work waits on it), then an open
/// request (a person asked for it), else the next task.
fn ready(
    shared: &Path,
    snapshot: &ProjectSnapshot,
    project_id: &ProjectId,
) -> Result<Option<String>, AgboardError> {
    let answers = unaccepted_answers(snapshot);
    if !answers.is_empty() {
        return serde_json::to_string(&AnswersOutput {
            kind: "answers",
            project_id: project_id.clone(),
            cursor: snapshot.cursor.clone(),
            answers,
        })
        .map(Some)
        .map_err(|error| AgboardError::BoardUnavailable {
            reason: error.to_string(),
        });
    }
    let requests = open_requests(snapshot);
    if !requests.is_empty() {
        return serde_json::to_string(&RequestsOutput {
            kind: "requests",
            project_id: project_id.clone(),
            cursor: snapshot.cursor.clone(),
            requests,
        })
        .map(Some)
        .map_err(|error| AgboardError::BoardUnavailable {
            reason: error.to_string(),
        });
    }
    select(snapshot)
        .map(|task| render_task(shared, snapshot, project_id, task))
        .transpose()
}

fn select(snapshot: &ProjectSnapshot) -> Option<&TaskView> {
    crate::progress::ordered_tasks(snapshot)
        .into_iter()
        .find(|task| {
            task.assignee == Assignee::Ai
                && matches!(task.task_status, Column::Todo | Column::Doing)
                && task.agent_status == RunState::Idle
                && task.draft.is_none()
                && task.archived_at.is_none()
        })
}

fn render_task(
    shared: &Path,
    snapshot: &ProjectSnapshot,
    project_id: &ProjectId,
    task: &TaskView,
) -> Result<String, AgboardError> {
    let project_dir = layout::project_dir(shared, project_id);
    let document_path = task.epic_id.as_deref().and_then(|epic_id| {
        snapshot
            .epics
            .iter()
            .find(|epic| epic.id.as_str() == epic_id)
            .map(|epic| layout::epic_document(&layout::epic_dir(&project_dir, &epic.id)))
    });
    let output = TaskOutput {
        kind: "task",
        project_id: project_id.clone(),
        cursor: snapshot.cursor.clone(),
        task: task.clone(),
        task_path: layout::task_md(&layout::task_dir(&project_dir, task.id)),
        document_path,
    };
    serde_json::to_string(&output).map_err(|error| AgboardError::BoardUnavailable {
        reason: error.to_string(),
    })
}
