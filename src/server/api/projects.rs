//! The catalog, a project's board and archive, and the local-only health and
//! notify routes.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Serialize;

use crate::docs::DocsRoot;
use crate::file_store::model::TaskView;
use crate::server::response::{agboard_error_response, json_response};
use crate::server::store::{indexed_view, parse_project_id, with_files};
use crate::server::{AppState, epic_counts};

/// The catalog: every project by name, without tasks. Read in one transaction.
pub(super) async fn projects(State(state): State<Arc<AppState>>) -> Response {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ListedProject<'a> {
        #[serde(flatten)]
        meta: &'a crate::domain::ProjectMeta,
        docs_path: String,
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Listed<'a> {
        projects: Vec<ListedProject<'a>>,
        catalog_version: &'a str,
    }
    match with_files(&state, |files| files.catalog()).await {
        Ok(catalog) => {
            let projects = catalog
                .projects
                .iter()
                .map(|meta| {
                    let docs = DocsRoot::of_project(&state.shared, &meta.id);
                    let docs = std::path::absolute(docs.dir()).unwrap_or(docs.dir().to_path_buf());
                    ListedProject {
                        meta,
                        docs_path: docs.to_string_lossy().into_owned(),
                    }
                })
                .collect();
            let listed = Listed {
                projects,
                catalog_version: &catalog.catalog_version,
            };
            json_response(StatusCode::OK, &listed)
        }
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn board(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match indexed_view(&state, &project_id) {
        Ok(view) => {
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct BoardResponse<'a> {
                project: &'a crate::domain::ProjectMeta,
                version: &'a str,
                cursor: &'a crate::domain::ChangeCursor,
                epics: &'a [crate::file_store::model::EpicView],
                epic_task_counts:
                    &'a std::collections::BTreeMap<String, epic_counts::EpicTaskCounts>,
                tasks: Vec<&'a TaskView>,
                problems: &'a [crate::file_store::model::Problem],
            }
            let epic_task_counts = epic_counts::task_counts_by_epic(&view.epics, &view.tasks);
            let tasks = view
                .tasks
                .iter()
                .filter(|c| c.archived_at.is_none())
                .collect();
            json_response(
                StatusCode::OK,
                &BoardResponse {
                    project: &view.project,
                    version: &view.version,
                    cursor: &view.cursor,
                    epics: &view.epics,
                    epic_task_counts: &epic_task_counts,
                    tasks,
                    problems: &view.problems,
                },
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn archive(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match indexed_view(&state, &project_id) {
        Ok(view) => json_response(
            StatusCode::OK,
            &serde_json::json!({
                "project": view.project,
                "version": view.version,
                "cursor": view.cursor,
                "tasks": view.tasks.iter().filter(|c| c.archived_at.is_some()).collect::<Vec<_>>(),
                "epics": &view.epics,
            }),
        ),
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn health() -> Response {
    #[derive(Serialize)]
    struct Health {
        ok: bool,
        pid: u32,
    }
    json_response(
        StatusCode::OK,
        &Health {
            ok: true,
            pid: std::process::id(),
        },
    )
}

/// A change was made elsewhere (the CLI). Queue a reload of every project; the
/// browsers hear about it only if a version actually changed.
pub(super) async fn notify(State(state): State<Arc<AppState>>) -> StatusCode {
    state.reloader.all();
    StatusCode::NO_CONTENT
}
