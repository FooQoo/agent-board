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
use crate::server::resident::{AutoStart, Health, Launched, resolve_project};
use crate::server::response::{agboard_error_response, json_response};
use crate::server::sessions::{SessionList, Tool};
use crate::server::store::{parse_project_id, with_files};

#[derive(Serialize)]
struct Listed {
    #[serde(flatten)]
    list: SessionList,
    launched: Vec<Launched>,
    /// The health of the session of each tool.
    health: Health,
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
            // External sessions count by their waits; the session the board launched counts by
            // its driver, so it is added here.
            let mut list = state.sessions.list(&project_id);
            if let Some(board) = state.resident.board_session(&project_id) {
                list = list.with_session(board);
            }
            let health = state.resident.health();
            json_response(
                StatusCode::OK,
                &Listed {
                    list,
                    launched,
                    health,
                },
            )
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
    /// Ignored: the board launches one session in total, so a stop names no tool.
    #[serde(default)]
    #[allow(dead_code)]
    tool: Option<Tool>,
}

pub(super) async fn stop_session(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    ApiJson(_body): ApiJson<StopBody>,
) -> Response {
    if let Err(error) = parse_project_id(&raw_project) {
        return agboard_error_response(&error);
    }
    let launcher = state.resident.clone();
    match blocking(move || launcher.stop()).await {
        Ok(stopped) => json_response(StatusCode::OK, &serde_json::json!({ "stopped": stopped })),
        Err(error) => agboard_error_response(&error),
    }
}

/// The name of the project and the first of its bound folders that still exists.
async fn project_folder(
    state: &AppState,
    project: ProjectId,
) -> Result<(String, std::path::PathBuf), AgboardError> {
    with_files(state, move |files| resolve_project(&files, &project)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AutoStartBody {
    /// Required when `enabled` is true.
    #[serde(default)]
    tool: Option<Tool>,
    enabled: bool,
    #[serde(default)]
    model: Option<String>,
}

/// Save whether the session of a tool starts with the server, and with which project and model.
/// It does not launch anything by itself.
pub(super) async fn set_autostart(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    ApiJson(body): ApiJson<AutoStartBody>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let result = async {
        let model = body
            .model
            .as_deref()
            .filter(|model| !model.is_empty() && *model != "default");
        let choice = if body.enabled {
            let tool = crate::server::resident::cli::launchable(body.tool.ok_or_else(|| {
                AgboardError::InvalidValue {
                    field: "tool".to_string(),
                    reason: "tool is required to turn auto-start on.".to_string(),
                }
            })?)?;
            if let Some(model) =
                model.filter(|model| !crate::server::resident::cli::valid_model(model))
            {
                return Err(AgboardError::InvalidValue {
                    field: "model".to_string(),
                    reason: format!("\"{model}\" is not a model name."),
                });
            }
            project_folder(&state, project_id.clone()).await?;
            Some(AutoStart {
                tool,
                project_id,
                model: model.map(str::to_string),
            })
        } else {
            None
        };
        let launcher = state.resident.clone();
        let saved = choice.clone();
        blocking(move || launcher.autostart().set(saved)).await?;
        Ok(choice)
    }
    .await;
    match result {
        Ok(choice) => json_response(StatusCode::OK, &serde_json::json!({ "autoStart": choice })),
        Err(error) => agboard_error_response(&error),
    }
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
