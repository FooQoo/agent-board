//! The first-run guide's routes on the PC board: its state, the lease, the start,
//! the scripted steps, and the finish, abort, and recovery. The write guard in
//! `api` checks each `POST` first. The routes are not part of the monitor's
//! router, so the monitor and the tunnel never reach them.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Deserialize;

use super::super::AppState;
use super::super::request::ApiJson;
use super::super::response::{agboard_error_response, json_response};
use super::super::store::{parse_project_id, refresh_index, with_files, with_request_files};
use crate::file_store::onboarding_state::{GuideLocale, GuideTransition};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct ClaimInput {
    client_id: String,
    expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct HeartbeatInput {
    client_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct SkipInput {
    client_id: String,
    expected_revision: u64,
    command_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct StartInput {
    client_id: String,
    attempt_id: String,
    expected_revision: u64,
    locale: GuideLocale,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct RunCommandInput {
    client_id: String,
    expected_revision: u64,
    command_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct AdvanceInput {
    client_id: String,
    expected_revision: u64,
    command_id: String,
    transition: GuideTransition,
}

pub(super) async fn get_onboarding(State(state): State<Arc<AppState>>) -> Response {
    match with_files(&state, |store| store.guide()).await {
        Ok(file) => json_response(StatusCode::OK, &file),
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn claim_onboarding(
    State(state): State<Arc<AppState>>,
    ApiJson(input): ApiJson<ClaimInput>,
) -> Response {
    match with_files(&state, move |store| {
        store.guide_claim(
            &input.client_id,
            input.expected_revision,
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(file) => json_response(StatusCode::OK, &file),
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn replay_onboarding(
    State(state): State<Arc<AppState>>,
    ApiJson(input): ApiJson<ClaimInput>,
) -> Response {
    match with_files(&state, move |store| {
        store.guide_replay(
            &input.client_id,
            input.expected_revision,
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(file) => json_response(StatusCode::OK, &file),
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn heartbeat_onboarding(
    State(state): State<Arc<AppState>>,
    ApiJson(input): ApiJson<HeartbeatInput>,
) -> Response {
    match with_files(&state, move |store| {
        store.guide_heartbeat(&input.client_id, chrono::Utc::now())
    })
    .await
    {
        Ok(file) => json_response(StatusCode::OK, &file),
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn skip_onboarding(
    State(state): State<Arc<AppState>>,
    ApiJson(input): ApiJson<SkipInput>,
) -> Response {
    match with_files(&state, move |store| {
        store.guide_skip(
            &input.client_id,
            input.expected_revision,
            &input.command_id,
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(file) => json_response(StatusCode::OK, &file),
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn recover_onboarding(State(state): State<Arc<AppState>>) -> Response {
    match with_request_files(&state, &axum::http::HeaderMap::new(), |store| {
        store.guide_recover(chrono::Utc::now())?;
        store.guide()
    })
    .await
    {
        Ok(file) => {
            refresh_index(&state);
            json_response(StatusCode::OK, &file)
        }
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn start_onboarding(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    ApiJson(input): ApiJson<StartInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match with_request_files(&state, &axum::http::HeaderMap::new(), move |store| {
        store.guide_start(
            &project_id,
            &input.client_id,
            &input.attempt_id,
            input.expected_revision,
            input.locale,
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(file) => {
            refresh_index(&state);
            json_response(StatusCode::OK, &file)
        }
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn advance_onboarding(
    State(state): State<Arc<AppState>>,
    Path((raw_project, run_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<AdvanceInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match with_request_files(&state, &axum::http::HeaderMap::new(), move |store| {
        store.guide_advance(
            &project_id,
            &run_id,
            &input.client_id,
            input.expected_revision,
            &input.command_id,
            input.transition,
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(file) => {
            refresh_index(&state);
            json_response(StatusCode::OK, &file)
        }
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn finish_onboarding(
    State(state): State<Arc<AppState>>,
    Path((raw_project, run_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<RunCommandInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match with_request_files(&state, &axum::http::HeaderMap::new(), move |store| {
        store.guide_finish(
            &project_id,
            &run_id,
            &input.client_id,
            input.expected_revision,
            &input.command_id,
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(file) => {
            refresh_index(&state);
            json_response(StatusCode::OK, &file)
        }
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn abort_onboarding(
    State(state): State<Arc<AppState>>,
    Path((raw_project, run_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<RunCommandInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match with_request_files(&state, &axum::http::HeaderMap::new(), move |store| {
        store.guide_abort(
            &project_id,
            &run_id,
            &input.client_id,
            input.expected_revision,
            &input.command_id,
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(file) => {
            refresh_index(&state);
            json_response(StatusCode::OK, &file)
        }
        Err(error) => agboard_error_response(&error),
    }
}
