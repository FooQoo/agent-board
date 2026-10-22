//! `GET /api/events`: server-sent events.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::{Stream, StreamExt};

use super::AppState;
use super::change_feed::{ChangeFeed, resync_data};
use super::preferences::Preferences;
use super::web_assets::APP_BUILD_ID;

/// How often an idle connection gets a comment line, so proxies and browsers
/// keep it open.
const KEEP_ALIVE: Duration = Duration::from_secs(15);

/// `ready` right after connecting, carrying the board's build ID, then
/// `changed` for every change, with the project, the changed resources and their facets, the
/// server start's `instanceId` and the running number `seq`. A page whose own build ID differs
/// reloads.
///
/// The subscription is made before the response starts, so a change that
/// happens after the client sees `ready` is never missed. A client that lags
/// behind gets `resync`, which asks it to fetch everything again.
pub(crate) async fn events(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let feed = state.changed.clone();
    let changes = BroadcastStream::new(feed.subscribe())
        .map(move |received| Ok(change_event(&feed, received)));
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

/// The SSE event of one received change: `changed`, or `resync` when the stream fell behind.
pub(crate) fn change_event(
    feed: &ChangeFeed,
    received: Result<std::sync::Arc<super::change_feed::ChangeEvent>, BroadcastStreamRecvError>,
) -> Event {
    let (name, data) = change_payload(feed, received);
    Event::default().event(name).data(data)
}

/// The name and the JSON data of the event for one received change.
fn change_payload(
    feed: &ChangeFeed,
    received: Result<std::sync::Arc<super::change_feed::ChangeEvent>, BroadcastStreamRecvError>,
) -> (&'static str, String) {
    match received {
        Ok(event) => (
            "changed",
            serde_json::to_string(&feed.changed(&event)).unwrap_or_else(|_| "{}".into()),
        ),
        Err(BroadcastStreamRecvError::Lagged(_)) => ("resync", resync_data(feed)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_store::projection::{ChangeSet, Facet, Resource, ResourceChange, ResourceId};

    fn set(task: i64) -> ChangeSet {
        ChangeSet {
            project_id: "0123456789abcdef0123456789abcdef".parse().unwrap(),
            changes: vec![ResourceChange {
                resource: Resource::Task,
                id: ResourceId::Task(task),
                facets: vec![Facet::Summary],
            }],
        }
    }

    #[tokio::test]
    async fn a_stream_that_fell_behind_gets_resync_and_then_the_newest_changes() {
        let feed = ChangeFeed::with_capacity(2);
        let mut stream = BroadcastStream::new(feed.subscribe());
        for task in 1..=5 {
            feed.publish(set(task));
        }
        let lagged = stream.next().await.unwrap();
        let (name, data) = change_payload(&feed, lagged);
        assert_eq!(name, "resync");
        let value: serde_json::Value = serde_json::from_str(&data).unwrap();
        assert_eq!(value["instanceId"], feed.instance_id());
        assert_eq!(value["seq"], 5);
        // The events that were kept follow, numbered as they were.
        let (name, data) = change_payload(&feed, stream.next().await.unwrap());
        assert_eq!(name, "changed");
        let changed: crate::server::contracts::Changed = serde_json::from_str(&data).unwrap();
        assert_eq!(changed.seq, 4);
    }
}
