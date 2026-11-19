//! The agent sessions of a project: `GET /api/projects/{id}/sessions` lists the attached ones and
//! the board-launched children; the launcher routes (`sessions/models`, `sessions/launch`,
//! `sessions/stop`) start and stop the headless sessions and are served on the local entrance only.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::{Deserialize, Serialize};

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::server::AppState;
use crate::server::request::ApiJson;
use crate::server::resident::Launched;
use crate::server::response::{agboard_error_response, json_response};
use crate::server::sessions::{SessionList, Tool};
use crate::server::store::{parse_project_id, with_files};

#[derive(Serialize)]
struct Listed {
    #[serde(flatten)]
    list: SessionList,
    launched: Vec<Launched>,
}

pub(super) async fn list_sessions(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
) -> Response {
    match parse_project_id(&raw_project) {
        Ok(project_id) => {
            let launched = state
                .resident
                .status()
                .into_iter()
                .filter(|launched| launched.project_id == project_id)
                .collect();
            let list = state.sessions.list(&project_id);
            json_response(StatusCode::OK, &Listed { list, launched })
        }
        Err(error) => agboard_error_response(&error),
    }
}

#[derive(Deserialize)]
pub(super) struct ModelsQuery {
    tool: Tool,
}

pub(super) async fn session_models(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    Query(query): Query<ModelsQuery>,
) -> Response {
    if let Err(error) = parse_project_id(&raw_project) {
        return agboard_error_response(&error);
    }
    let launcher = state.resident.clone();
    let result = blocking(move || launcher.models(query.tool)).await;
    match result {
        Ok(list) => json_response(StatusCode::OK, &list),
        Err(error) => agboard_error_response(&error),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct LaunchBody {
    tool: Tool,
    #[serde(default)]
    model: Option<String>,
}

pub(super) async fn launch_session(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    ApiJson(body): ApiJson<LaunchBody>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let result = async {
        let (name, folder) = project_folder(&state, project_id.clone()).await?;
        let launcher = state.resident.clone();
        blocking(move || {
            launcher.launch(
                &project_id,
                &name,
                &folder,
                body.tool,
                // "default" and an empty name both leave the choice to the tool.
                body.model
                    .as_deref()
                    .filter(|model| !model.is_empty() && *model != "default"),
            )
        })
        .await
    }
    .await;
    match result {
        Ok(launched) => json_response(StatusCode::OK, &serde_json::json!({ "launched": launched })),
        Err(error) => agboard_error_response(&error),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StopBody {
    tool: Tool,
}

pub(super) async fn stop_session(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    ApiJson(body): ApiJson<StopBody>,
) -> Response {
    if let Err(error) = parse_project_id(&raw_project) {
        return agboard_error_response(&error);
    }
    let launcher = state.resident.clone();
    match blocking(move || launcher.stop(body.tool)).await {
        Ok(stopped) => json_response(StatusCode::OK, &serde_json::json!({ "stopped": stopped })),
        Err(error) => agboard_error_response(&error),
    }
}

/// The name of the project and the first of its bound folders that still exists.
async fn project_folder(
    state: &AppState,
    project: ProjectId,
) -> Result<(String, std::path::PathBuf), AgboardError> {
    with_files(state, move |files| {
        let catalog = files.catalog()?;
        let meta = catalog
            .projects
            .iter()
            .find(|meta| meta.id == project)
            .ok_or_else(|| AgboardError::ProjectNotFound {
                project: project.to_string(),
            })?;
        let folder = files
            .bindings()?
            .into_iter()
            .filter(|binding| binding.project_id == project)
            .map(|binding| binding.folder)
            .find(|folder| folder.is_dir())
            .ok_or_else(|| AgboardError::ProjectHasNoFolder {
                project: meta.name.clone(),
            })?;
        Ok((meta.name.clone(), folder))
    })
    .await
}

/// Run blocking launcher work (it starts and waits for processes) off the async threads.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, AgboardError> + Send + 'static,
) -> Result<T, AgboardError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| AgboardError::SessionLaunchFailed {
            reason: format!("The launcher task failed: {e}"),
        })?
}
