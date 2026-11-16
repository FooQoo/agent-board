//! The first-run guide's two routes on the board: whether this data area has seen
//! the guide, and recording how it ended. The write guard in `api` checks the
//! `POST` first. The guide itself runs in the web UI.

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use serde::Deserialize;

use super::super::AppState;
use super::super::request::ApiJson;
use super::super::response::{agboard_error_response, json_response};
use super::super::store::with_files;
use crate::file_store::onboarding_state::GuideOutcome;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeenInput {
    outcome: GuideOutcome,
}

pub(super) async fn get_onboarding(State(state): State<Arc<AppState>>) -> Response {
    match with_files(&state, |store| store.guide(chrono::Utc::now())).await {
        Ok(file) => json_response(StatusCode::OK, &file),
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn mark_onboarding_seen(
    State(state): State<Arc<AppState>>,
    ApiJson(input): ApiJson<SeenInput>,
) -> Response {
    match with_files(&state, move |store| {
        store.guide_seen(input.outcome, chrono::Utc::now())
    })
    .await
    {
        Ok(file) => json_response(StatusCode::OK, &file),
        Err(error) => agboard_error_response(&error),
    }
}
