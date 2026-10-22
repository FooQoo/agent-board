//! `GET /api/projects/{project_id}/tasks/{id}/detail` and `.../epics/{epic_id}/detail`. The
//! handlers are stubs until the Detail reader exists; the routes and the NDJSON contract are
//! fixed (`server::contracts::detail`).

use axum::extract::RawQuery;
use axum::response::Response;

use crate::server::contracts::detail::parse_sections;
use crate::server::response::{invalid_sections, not_implemented};

/// The value of the `sections` query parameter, if there is one.
fn sections_param(query: Option<&str>) -> Option<String> {
    query?.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        (name == "sections").then(|| value.replace("%2C", ",").replace("%2c", ","))
    })
}

/// The stub answer of a Detail route: `400` for a bad `sections`, else `501`. The monitor's
/// routes use it too.
pub(crate) fn detail_stub(query: Option<String>, what: &str) -> Response {
    let raw = sections_param(query.as_deref());
    match parse_sections(raw.as_deref()) {
        Ok(_) => not_implemented(what),
        Err(_) => invalid_sections(),
    }
}

pub(super) async fn task_detail(RawQuery(query): RawQuery) -> Response {
    detail_stub(query, "The task detail")
}

pub(super) async fn epic_detail(RawQuery(query): RawQuery) -> Response {
    detail_stub(query, "The epic detail")
}
