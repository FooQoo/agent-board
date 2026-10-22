//! `GET /api/projects/{project_id}/tasks/{id}/detail` and `.../epics/{epic_id}/detail`: the
//! Detail NDJSON stream (`server::contracts::detail`). The monitor's routes answer through the
//! same functions.
//!
//! The target is copied out of the index's snapshot first; the response is then sent from that
//! copy, so neither the index nor a file is touched while it goes out.

use std::convert::Infallible;
use std::path::Path as FsPath;
use std::sync::{Arc, RwLock};

use axum::body::{Body, Bytes};
use axum::extract::{Path, RawQuery, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures_util::stream;

use super::parse_task_id;
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::detail::DetailSnapshot;
use crate::file_store::index::ProjectIndex;
use crate::file_store::validate::EpicId;
use crate::server::AppState;
use crate::server::contracts::NDJSON_CONTENT_TYPE;
use crate::server::contracts::detail::{DetailEvent, Section, parse_sections};
use crate::server::response::{agboard_error_response, invalid_sections};
use crate::server::store::{indexed_view_in, parse_project_id};

/// About how many bytes one piece of the response holds.
const CHUNK_BYTES: usize = 16 * 1024;

/// The value of the `sections` query parameter, if there is one.
fn sections_param(query: Option<&str>) -> Option<String> {
    query?.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        (name == "sections").then(|| value.replace("%2C", ",").replace("%2c", ","))
    })
}

/// The requested sections, or `None` when the query is not one the contract allows.
fn requested_sections(query: Option<&str>) -> Option<Vec<Section>> {
    parse_sections(sections_param(query).as_deref()).ok()
}

/// What a Detail route names.
pub(crate) enum Target {
    Task(String),
    Epic(String),
}

/// Answer a Detail request. A bad `sections` is `400` and a missing project, task or epic is
/// `404`, both before any byte of the stream.
pub(crate) async fn detail_response(
    shared: &FsPath,
    index: &RwLock<ProjectIndex>,
    raw_project: &str,
    target: Target,
    query: Option<String>,
) -> Response {
    let Some(mut sections) = requested_sections(query.as_deref()) else {
        return invalid_sections();
    };
    if matches!(target, Target::Epic(_)) {
        // An epic has a document and no history: no query means the document, and a query that
        // asks for the history is invalid.
        if sections_param(query.as_deref()).is_none() {
            sections = vec![Section::Document];
        } else if sections != [Section::Document] {
            return invalid_sections();
        }
    }
    let project_id: ProjectId = match parse_project_id(raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let target = match target {
        Target::Task(raw) => match parse_task_id(&raw) {
            Ok(id) => Resolved::Task(id),
            Err(response) => return *response,
        },
        Target::Epic(raw) => match raw.parse::<EpicId>() {
            Ok(id) => Resolved::Epic(id),
            Err(_) => return agboard_error_response(&AgboardError::EpicNotFound { id: raw }),
        },
    };
    // The index is only read here, and only long enough to take the snapshot's `Arc`.
    let snapshot = match indexed_view_in(shared, index, &project_id) {
        Ok(snapshot) => snapshot,
        Err(error) => return agboard_error_response(&error),
    };
    let shared = shared.to_path_buf();
    let built = tokio::task::spawn_blocking(move || {
        let detail = match &target {
            Resolved::Task(id) => DetailSnapshot::task(&shared, &snapshot, *id, &sections),
            Resolved::Epic(id) => DetailSnapshot::epic(&shared, &snapshot, id, &sections),
        }?;
        Ok::<_, AgboardError>(detail.events())
    })
    .await;
    match built {
        Ok(Ok(events)) => ndjson_response(&events),
        Ok(Err(error)) => agboard_error_response(&error),
        Err(error) => agboard_error_response(&AgboardError::DatabaseError {
            reason: format!("The detail task failed: {error}"),
        }),
    }
}

enum Resolved {
    Task(i64),
    Epic(EpicId),
}

fn ndjson_response(events: &[DetailEvent]) -> Response {
    let lines: Vec<String> = events.iter().map(DetailEvent::to_line).collect();
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, NDJSON_CONTENT_TYPE),
            (header::CACHE_CONTROL, "no-store"),
        ],
        chunked_body(lines),
    )
        .into_response()
}

/// The lines as pieces of about [`CHUNK_BYTES`], giving other tasks a turn between pieces.
/// The body owns the lines, so a client that leaves drops them with the body.
fn chunked_body(lines: Vec<String>) -> Body {
    Body::from_stream(stream::unfold(lines.into_iter(), |mut lines| async move {
        let mut chunk = String::new();
        for line in lines.by_ref() {
            chunk.push_str(&line);
            if chunk.len() >= CHUNK_BYTES {
                break;
            }
        }
        if chunk.is_empty() {
            return None;
        }
        tokio::task::yield_now().await;
        Some((Ok::<_, Infallible>(Bytes::from(chunk)), lines))
    }))
}

pub(super) async fn task_detail(
    State(state): State<Arc<AppState>>,
    Path((project, id)): Path<(String, String)>,
    RawQuery(query): RawQuery,
) -> Response {
    detail_response(
        &state.shared,
        &state.index,
        &project,
        Target::Task(id),
        query,
    )
    .await
}

pub(super) async fn epic_detail(
    State(state): State<Arc<AppState>>,
    Path((project, epic)): Path<(String, String)>,
    RawQuery(query): RawQuery,
) -> Response {
    detail_response(
        &state.shared,
        &state.index,
        &project,
        Target::Epic(epic),
        query,
    )
    .await
}

#[cfg(test)]
mod tests {
    use futures_util::StreamExt;

    use super::*;

    async fn pieces(lines: Vec<String>) -> Vec<String> {
        let mut stream = chunked_body(lines).into_data_stream();
        let mut out = Vec::new();
        while let Some(piece) = stream.next().await {
            out.push(String::from_utf8(piece.unwrap().to_vec()).unwrap());
        }
        out
    }

    #[tokio::test]
    async fn lines_are_grouped_into_pieces_of_about_sixteen_kilobytes() {
        let line = format!("{}\n", "x".repeat(5_000));
        let lines = vec![line.clone(); 10];
        let got = pieces(lines).await;
        assert_eq!(got.concat(), line.repeat(10));
        assert_eq!(got.len(), 3);
        assert!(got.iter().all(|p| p.ends_with('\n')));
        assert!(got.iter().all(|p| p.len() < CHUNK_BYTES + 5_001));
        assert!(pieces(Vec::new()).await.is_empty());
    }

    #[tokio::test]
    async fn dropping_the_body_early_releases_the_lines() {
        let lines = vec![format!("{}\n", "y".repeat(20_000)); 4];
        let mut stream = chunked_body(lines).into_data_stream();
        assert!(stream.next().await.unwrap().is_ok());
        drop(stream);
    }

    #[test]
    fn the_sections_query_follows_the_contract() {
        assert_eq!(
            requested_sections(None),
            Some(vec![Section::Document, Section::History])
        );
        assert_eq!(
            requested_sections(Some("sections=history")),
            Some(vec![Section::History])
        );
        assert_eq!(
            requested_sections(Some("x=1&sections=document%2Chistory")),
            Some(vec![Section::Document, Section::History])
        );
        assert_eq!(requested_sections(Some("sections=body")), None);
        assert_eq!(requested_sections(Some("sections=")), None);
    }
}
