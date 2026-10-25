//! The catalog, a project's archive, and the local-only health and
//! notify routes.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Serialize;

use crate::docs::DocsRoot;
use crate::server::AppState;
use crate::server::response::{agboard_error_response, json_response};
use crate::server::store::{indexed_view, parse_project_id, with_files};

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
