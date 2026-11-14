//! Wait for a change to one project, then return one complete read-only
//! snapshot of it. The wait engine owns event handling and the absolute
//! deadline; this adapter supplies the cursor predicate and CLI meaning.

use std::path::Path;
use std::time::Duration;

use crate::{
    agent::wait_engine::{Evaluation, WaitReader, WaitResult, wait_until},
    clock::{Clock, SystemClock, format_utc},
    domain::{ChangeCursor, ProjectId, validate_project_name},
    error::AgboardError,
    file_store::{
        FileStore,
        reader::{FetchedSnapshot, ProjectSnapshot},
    },
};

/// Reads of the one project with a fixed ID.
struct Reader<'a> {
    shared: &'a Path,
    name: &'a str,
    id: ProjectId,
}

impl WaitReader for Reader<'_> {
    type Snapshot = ProjectSnapshot;

    fn read(&self) -> Result<Self::Snapshot, AgboardError> {
        FileStore::open(self.shared)
            .board(&self.id)
            .map_err(|error| match error {
                AgboardError::ProjectNotFound { .. } => AgboardError::ProjectNotFound {
                    project: self.name.to_string(),
                },
                other => AgboardError::BoardUnavailable {
                    reason: format!("{} {}", other.message(), other.reason()),
                },
            })
    }
}

/// Resolve `name` to its project, once, and check that the cursor belongs to it.
fn resolve(shared: &Path, name: &str, cursor: &ChangeCursor) -> Result<ProjectId, AgboardError> {
    let name = validate_project_name(name)?;
    let id = FileStore::open(shared)
        .project_by_name(&name)
        .map_err(|error| match error {
            AgboardError::ProjectNotFound { .. } => AgboardError::ProjectNotFound {
                project: name.clone(),
            },
            other => AgboardError::BoardUnavailable {
                reason: format!("{} {}", other.message(), other.reason()),
            },
        })?
        .id;
    if id != cursor.project_id {
        return Err(AgboardError::CursorInvalid {
            reason: "The cursor belongs to a different project. Use the cursor from a snapshot of this project."
                .into(),
        });
    }
    Ok(id)
}

/// Wait for a change to the project named `project`, on the board at
/// `shared_dir` and the server that serves that same data directory.
///
/// Returns the latest complete snapshot as JSON. A timeout, lost connection,
/// or invalid cursor is an error, never an answer. Nothing is written and no
/// polling happens; reads follow only the initial request and server events.
pub async fn wait_for_change(
    shared_dir: &Path,
    project: &str,
    cursor: ChangeCursor,
    timeout_secs: Option<u64>,
) -> Result<String, AgboardError> {
    let deadline =
        timeout_secs.map(|seconds| tokio::time::Instant::now() + Duration::from_secs(seconds));
    let id = resolve(shared_dir, project, &cursor)?;
    let reader = Reader {
        shared: shared_dir,
        name: project,
        id,
    };
    let result = wait_until(shared_dir, &reader, deadline, |snapshot| {
        if snapshot.version == cursor.version {
            return Ok(Evaluation::Continue);
        }
        let json = serde_json::to_string(&FetchedSnapshot {
            fetched_at: format_utc(SystemClock.now()),
            snapshot,
        })
        .map_err(|error| AgboardError::BoardUnavailable {
            reason: error.to_string(),
        })?;
        Ok(Evaluation::Ready(json))
    })
    .await?;
    match result {
        WaitResult::Satisfied(json) => Ok(json),
        WaitResult::DeadlineReached(_) => Err(AgboardError::WaitTimeout),
    }
}
