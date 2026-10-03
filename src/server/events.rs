//! `GET /api/events`: server-sent events.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

use super::AppState;

/// How often an idle connection gets a comment line, so proxies and browsers
/// keep it open.
const KEEP_ALIVE: Duration = Duration::from_secs(15);

/// `ready` right after connecting, then `changed` for every change.
///
/// The subscription is made before the response starts, so a change that
/// happens after the client sees `ready` is never missed. A client that lags
/// behind simply gets a `changed` and refetches the whole board.
pub(crate) async fn events(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let changes = BroadcastStream::new(state.changed.subscribe());
    let stream = tokio_stream::once(Ok(Event::default().event("ready").data("{}")))
        .chain(changes.map(|_| Ok(Event::default().event("changed").data("{}"))));
    Sse::new(stream).keep_alive(KeepAlive::new().interval(KEEP_ALIVE))
}
