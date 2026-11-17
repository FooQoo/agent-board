//! Open requests in the progress table: the agent sees what a person asked it.

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::file_store::qa::RequestStatus;
use crate::file_store::reader::ProjectSnapshot;

/// An open request, shortened: the agent reads the whole text with `message show`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressRequest {
    pub id: String,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    /// The first line of the request, at most `text::TITLE_LIMIT` characters.
    pub title: String,
}

/// The open requests of a snapshot in ID order.
pub fn open_requests(snapshot: &ProjectSnapshot) -> Vec<ProgressRequest> {
    snapshot
        .requests
        .iter()
        .filter(|request| request.status == RequestStatus::Open)
        .map(|request| ProgressRequest {
            id: request.id.clone(),
            created_at: request.created_at,
            title: super::text::request_title(&request.body),
        })
        .collect()
}
