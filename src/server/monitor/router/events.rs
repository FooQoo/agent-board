//! The server-sent event stream of the monitor: change notices of one project,
//! saved preferences and a heartbeat.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{RawQuery, State};
use axum::response::sse::Event;
use axum::response::{IntoResponse, Response, Sse};
use futures_util::stream::{self, Stream, StreamExt};
use tokio::sync::broadcast;

use super::MonitorState;
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::server::change_feed::{ChangeEvent, ChangeFeed};
use crate::server::preferences::{Preferences, PreferencesStore};
use crate::server::response::agboard_error_response;
use crate::server::store::parse_project_id;
use crate::server::web_assets::MONITOR_BUILD_ID;

/// The project a monitor stream follows: `?project=<id>`. A missing or malformed ID is
/// `invalid_value` and an ID that names no project is `project_not_found`.
fn stream_project(state: &MonitorState, query: Option<&str>) -> Result<ProjectId, AgboardError> {
    let raw = query.and_then(|query| {
        query.split('&').find_map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (name == "project").then_some(value)
        })
    });
    let Some(raw) = raw.filter(|raw| !raw.is_empty()) else {
        return Err(AgboardError::InvalidValue {
            field: "project".into(),
            reason: "The events stream needs ?project=<project ID>.".into(),
        });
    };
    let id = parse_project_id(raw)?;
    let known = state
        .index
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .entry(&id)
        .is_some();
    if known {
        Ok(id)
    } else {
        Err(AgboardError::ProjectNotFound {
            project: id.to_string(),
        })
    }
}

pub(super) async fn events(
    State(state): State<Arc<MonitorState>>,
    RawQuery(query): RawQuery,
) -> Response {
    let project = match stream_project(&state, query.as_deref()) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    let stream = event_stream(
        state.changed.clone(),
        project,
        state.preferences_changed.subscribe(),
        state.preferences.clone(),
    );
    Sse::new(stream.map(|event| Ok::<_, Infallible>(event.into_sse()))).into_response()
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum MonitorEvent {
    Ready,
    /// The JSON of a `changed` event.
    Changed(String),
    /// The JSON of a `resync` event.
    Resync(String),
    Preferences(Preferences),
    Heartbeat,
}

impl MonitorEvent {
    fn into_sse(self) -> Event {
        match self {
            Self::Ready => Event::default()
                .event("ready")
                .data(format!(r#"{{"build":"{MONITOR_BUILD_ID}"}}"#)),
            Self::Changed(data) => Event::default().event("changed").data(data),
            Self::Resync(data) => Event::default().event("resync").data(data),
            Self::Preferences(prefs) => Event::default()
                .event("preferences")
                .data(serde_json::to_string(&prefs).unwrap_or_else(|_| "{}".to_string())),
            Self::Heartbeat => Event::default().event("heartbeat").data("{}"),
        }
    }
}

/// The `changed` JSON of a stream that follows one project, or `None` for an event that is not
/// for it. The project list changes (`project` resources) are not sent. The numbers are counted
/// on this stream, so the events of other projects leave no gap; a stream that fell behind gets
/// `resync` instead.
fn project_changed(
    feed: &ChangeFeed,
    project: &ProjectId,
    event: &ChangeEvent,
    seq: u64,
) -> Option<String> {
    if &event.set.project_id != project {
        return None;
    }
    let mut changed = feed.changed(event);
    changed
        .changes
        .retain(|change| change.resource != crate::server::contracts::ChangeResource::Project);
    if changed.changes.is_empty() {
        return None;
    }
    changed.seq = seq;
    serde_json::to_string(&changed).ok()
}

fn event_stream(
    feed: ChangeFeed,
    project: ProjectId,
    saved: broadcast::Receiver<Preferences>,
    store: PreferencesStore,
) -> impl Stream<Item = MonitorEvent> {
    let first_heartbeat = tokio::time::Instant::now() + Duration::from_secs(15);
    let receiver = feed.subscribe();
    let changes = stream::unfold(
        (
            receiver,
            saved,
            store,
            tokio::time::interval_at(first_heartbeat, Duration::from_secs(15)),
            0u64,
        ),
        move |(mut rx, mut saved, store, mut timer, mut seq)| {
            let feed = feed.clone();
            let project = project.clone();
            async move {
                loop {
                    tokio::select! {
                        changed = rx.recv() => match changed {
                            Ok(event) => {
                                if let Some(data) = project_changed(&feed, &project, &event, seq + 1) {
                                    seq += 1;
                                    return Some((MonitorEvent::Changed(data), (rx, saved, store, timer, seq)));
                                }
                            }
                            Err(broadcast::error::RecvError::Lagged(_)) => {
                                let data = serde_json::json!({"instanceId": feed.instance_id(), "seq": seq}).to_string();
                                return Some((MonitorEvent::Resync(data), (rx, saved, store, timer, seq)));
                            }
                            Err(broadcast::error::RecvError::Closed) => return None,
                        },
                        prefs = saved.recv() => return Some((match prefs {
                            Ok(prefs) => MonitorEvent::Preferences(prefs),
                            // A lagged notice is replaced by the value that is saved now.
                            Err(broadcast::error::RecvError::Lagged(_)) => MonitorEvent::Preferences(store.load()),
                            Err(broadcast::error::RecvError::Closed) => return None,
                        }, (rx, saved, store, timer, seq))),
                        _ = timer.tick() => return Some((MonitorEvent::Heartbeat, (rx, saved, store, timer, seq))),
                    }
                }
            }
        },
    );
    stream::once(async { MonitorEvent::Ready }).chain(changes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn a_saved_preference_is_sent_as_a_preferences_event_not_changed() {
        use crate::server::preferences::Theme;
        let changed = ChangeFeed::new();
        let (saved, _) = broadcast::channel(4);
        let store = PreferencesStore::new(std::path::Path::new("."));
        let project: ProjectId = "0123456789abcdef0123456789abcdef".parse().unwrap();
        let mut events = Box::pin(event_stream(changed, project, saved.subscribe(), store));
        assert_eq!(events.next().await, Some(MonitorEvent::Ready));
        let prefs = Preferences {
            locale: "ja".to_string(),
            theme: Theme {
                mode: "dark".to_string(),
                accent: "teal".to_string(),
            },
            revision: 1,
        };
        saved.send(prefs.clone()).unwrap();
        assert_eq!(events.next().await, Some(MonitorEvent::Preferences(prefs)));
    }

    #[tokio::test(start_paused = true)]
    async fn monitor_sse_sends_ready_then_a_fifteen_second_heartbeat() {
        let changed = ChangeFeed::new();
        let (saved, _) = broadcast::channel(4);
        let store = PreferencesStore::new(std::path::Path::new("."));
        let project: ProjectId = "0123456789abcdef0123456789abcdef".parse().unwrap();
        let mut events = Box::pin(event_stream(changed, project, saved.subscribe(), store));
        assert_eq!(events.next().await.unwrap(), MonitorEvent::Ready);
        tokio::time::advance(Duration::from_secs(14)).await;
        assert!(
            tokio::time::timeout(Duration::from_millis(1), events.next())
                .await
                .is_err()
        );
        tokio::time::advance(Duration::from_secs(1)).await;
        assert_eq!(events.next().await.unwrap(), MonitorEvent::Heartbeat);
    }
}
