//! The wire contract of the data layer: the Summary, the Detail NDJSON stream and the SSE
//! `changed` payload. These types only describe the shapes; the handlers that fill them live in
//! `api` (PC) and `monitor` (mobile monitor).
//!
//! Every type is camelCase and refuses unknown fields, so a response that grows a field the
//! clients do not know is caught by the golden examples in `tests/fixtures/data-layer/`.

pub mod changes;
pub mod detail;
pub mod stream;
pub mod summary;

use serde::{Deserialize, Serialize};

pub use changes::{Change, ChangeId, ChangeResource, Changed, Facet};
pub use detail::{
    BlockKind, DetailEvent, DetailImage, DetailResource, ResourceId, Section, Versions,
};
pub use stream::{StreamError, StreamValidator};
pub use summary::{
    AcceptanceCount, DetailVersions, EpicDetailVersions, Summary, SummaryEpic, SummaryEpicProgress,
    SummaryProblem, SummaryProject, SummaryTask,
};

/// The error code of a route that is registered but has no handler yet.
pub const NOT_IMPLEMENTED: &str = "not_implemented";
/// The error code of a `sections` query that is not `document`, `history` or both.
pub const INVALID_SECTIONS: &str = "invalid_sections";
/// The media type of a Detail response.
pub const NDJSON_CONTENT_TYPE: &str = "application/x-ndjson";

/// An opaque content hash: the first bytes of a SHA-256 over the parsed data, in hexadecimal.
/// Clients compare versions for equality and never read them.
pub type Version = String;

/// One decision option, named as in the board's `Task`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PendingChoice {
    pub id: String,
    pub label: String,
}
