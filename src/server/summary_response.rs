//! The Summary response, the same for the PC server and the monitor.
//!
//! It is built from the project's projection in the index: no file is read and nothing is
//! parsed again. The `version` is the `ETag`; a request whose `If-None-Match` names it gets
//! `304` and no body.

use std::path::Path;
use std::sync::RwLock;

use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

use super::contracts::summary::OnboardingSampleRef;
use super::contracts::{
    AcceptanceCount, DetailVersions, EpicDetailVersions, PendingChoice, Summary, SummaryEpic,
    SummaryEpicProgress, SummaryProblem, SummaryProject, SummaryTask,
};
use super::response::{agboard_error_response, json_response};
use super::store::{indexed_projection_in, parse_project_id};
use crate::file_store::index::ProjectIndex;
use crate::file_store::projection::Projection;

/// `GET .../projects/{id}/summary`.
pub(crate) fn respond(
    shared: &Path,
    index: &RwLock<ProjectIndex>,
    raw_project: &str,
    headers: &HeaderMap,
) -> Response {
    let projection = match parse_project_id(raw_project)
        .and_then(|id| indexed_projection_in(shared, index, &id))
    {
        Ok(projection) => projection,
        Err(error) => return agboard_error_response(&error),
    };
    let etag = format!("\"{}\"", projection.version);
    let value = HeaderValue::from_str(&etag).ok();
    let mut response = if matches_etag(headers, &etag) {
        (
            StatusCode::NOT_MODIFIED,
            [(header::CACHE_CONTROL, "no-store")],
        )
            .into_response()
    } else {
        json_response(StatusCode::OK, &summary_of(&projection))
    };
    if let Some(value) = value {
        response.headers_mut().insert(header::ETAG, value);
    }
    response
}

/// Whether `If-None-Match` names this tag: a list of tags (weak ones compare as strong ones
/// do here) or `*`.
fn matches_etag(headers: &HeaderMap, etag: &str) -> bool {
    headers
        .get_all(header::IF_NONE_MATCH)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .any(|candidate| {
            candidate == "*" || candidate.strip_prefix("W/").unwrap_or(candidate) == etag
        })
}

/// The Summary a projection stands for. The archived tasks are not in it.
pub(crate) fn summary_of(projection: &Projection) -> Summary {
    Summary {
        project: SummaryProject {
            id: projection.project_id.clone(),
            name: projection.project_name.clone(),
        },
        version: projection.version.clone(),
        tasks: projection
            .tasks
            .iter()
            .filter(|task| !task.archived)
            .map(|task| {
                let f = &task.fields;
                SummaryTask {
                    id: f.id,
                    title: f.title.clone(),
                    task_status: f.task_status,
                    agent_status: f.agent_status,
                    assignee: f.assignee,
                    is_draft: f.is_draft,
                    position: f.position,
                    epic_id: f.epic_id.clone(),
                    acceptance: AcceptanceCount {
                        done: f.acceptance_done,
                        total: f.acceptance_total,
                    },
                    updated_at: f.updated_at.clone(),
                    pending_request_id: f.pending_request_id.clone(),
                    pending_reason: f.pending_reason.clone(),
                    pending_choices: f
                        .pending_choices
                        .iter()
                        .map(|c| PendingChoice {
                            id: c.id.clone(),
                            label: c.label.clone(),
                        })
                        .collect(),
                    task_status_changed_at: f.task_status_changed_at.clone(),
                    agent_status_changed_at: f.agent_status_changed_at.clone(),
                    onboarding_sample: f.onboarding_sample.as_ref().map(|(run_id, ordinal)| {
                        OnboardingSampleRef {
                            run_id: run_id.clone(),
                            ordinal: *ordinal,
                        }
                    }),
                    detail_versions: DetailVersions {
                        document: task.document_version.clone(),
                        history: task.history_version.clone(),
                    },
                }
            })
            .collect(),
        epics: projection
            .epics
            .iter()
            .map(|epic| SummaryEpic {
                id: epic.fields.id.clone(),
                name: epic.fields.name.clone(),
                color: epic.fields.color.clone(),
                is_draft: epic.fields.is_draft,
                progress: SummaryEpicProgress {
                    todo: epic.progress.todo,
                    doing: epic.progress.doing,
                    done: epic.progress.done,
                    archived: epic.progress.archived,
                    total: epic.progress.total,
                },
                detail_versions: EpicDetailVersions {
                    document: epic.document_version.clone(),
                },
            })
            .collect(),
        problems: projection
            .problems
            .iter()
            .map(|p| SummaryProblem {
                file: p.file.clone(),
                field: p.field.clone(),
                reason: p.reason.clone(),
            })
            .collect(),
    }
}
