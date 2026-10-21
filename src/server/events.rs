//! `GET /api/events`: server-sent events.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

use super::AppState;
use super::preferences::Preferences;
use super::web_assets::APP_BUILD_ID;

/// How often an idle connection gets a comment line, so proxies and browsers
/// keep it open.
const KEEP_ALIVE: Duration = Duration::from_secs(15);

/// `ready` right after connecting, carrying the board's build ID, then
/// `changed` for every change. A page whose own build ID differs reloads.
///
/// The subscription is made before the response starts, so a change that
/// happens after the client sees `ready` is never missed. A client that lags
/// behind simply gets a `changed` and refetches the whole board.
pub(crate) async fn events(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let changes = BroadcastStream::new(state.changed.subscribe())
        .map(|_| Ok(Event::default().event("changed").data("{}")));
    let store = state.preferences.clone();
    let preferences =
        BroadcastStream::new(state.preferences_changed.subscribe()).map(move |saved| {
            // A lagged notice is replaced by the value that is saved now.
            let prefs = saved.unwrap_or_else(|_| store.load());
            Ok(preference_event(&prefs))
        });
    let stream = tokio_stream::once(Ok(Event::default()
        .event("ready")
        .data(format!(r#"{{"build":"{APP_BUILD_ID}"}}"#))))
    .chain(changes.merge(preferences));
    Sse::new(stream).keep_alive(KeepAlive::new().interval(KEEP_ALIVE))
}

/// `preferences` carries the saved language and theme, the same JSON as the
/// `GET` answer. It is never `changed`, so the board is not refetched.
fn preference_event(prefs: &Preferences) -> Event {
    let data = serde_json::to_string(prefs).unwrap_or_else(|_| "{}".to_string());
    Event::default().event("preferences").data(data)
}
