//! The task that follows the change feed and hands each change to the dispatcher.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::str::FromStr;
use std::sync::{Arc, Weak};
use std::time::Duration;

use tokio::sync::broadcast::error::TryRecvError;

use super::deliver::{Context, Dispatcher, NowFn};
use super::events::{ProjectFacts, diff, project_facts};
use super::ledger::Ledger;
use super::message::Lang;
use super::transport::PushTransport;
use crate::domain::ProjectId;
use crate::server::AppState;

/// How long after a change the task waits for more, so that the saves of one piece of work
/// (a result, then the state it moves to) become one notification.
const SETTLE: Duration = Duration::from_millis(600);
/// How often the failed sends are looked at.
const RETRY_EVERY: Duration = Duration::from_secs(30);

type Known = HashMap<String, ProjectFacts>;

/// The facts of a project as the index has them now. `None` when the project is gone.
fn current(state: &AppState, project: &str) -> Option<ProjectFacts> {
    let id = ProjectId::from_str(project).ok()?;
    let index = state.index.read().unwrap_or_else(|e| e.into_inner());
    let snapshot = index.entry(&id)?.last_good()?;
    Some(project_facts(&snapshot.tasks))
}

fn baseline(state: &AppState) -> Known {
    let index = state.index.read().unwrap_or_else(|e| e.into_inner());
    index
        .entries()
        .filter_map(|(id, entry)| {
            let snapshot = entry.last_good()?;
            Some((id.to_string(), project_facts(&snapshot.tasks)))
        })
        .collect()
}

/// What delivery works with right now, or `None` when no device is subscribed.
fn context(state: &AppState) -> Option<Context> {
    let subscriptions = state.monitor.push_subscriptions();
    if subscriptions.is_empty() {
        return None;
    }
    Some(Context {
        store: state.monitor.push_store().clone(),
        subscriptions,
        origin: state.monitor.public_origin(),
        settings: state.notification_settings.load(),
        lang: Lang::from_locale(&state.preferences.load().locale),
    })
}

/// Follow the board's changes and send the notifications they call for. The task ends with the
/// server (or when the change feed closes).
pub(crate) fn start(state: &Arc<AppState>, data_dir: &Path, transport: Arc<dyn PushTransport>) {
    let now: NowFn = Arc::new(chrono::Utc::now);
    let dispatcher = Dispatcher::new(Ledger::open(data_dir), transport, now);
    let known = baseline(state);
    let changes = state.changed.subscribe();
    let weak = Arc::downgrade(state);
    tokio::spawn(follow(weak, changes, known, dispatcher));
}

async fn follow(
    weak: Weak<AppState>,
    mut changes: tokio::sync::broadcast::Receiver<Arc<crate::server::change_feed::ChangeEvent>>,
    mut known: Known,
    dispatcher: Dispatcher,
) {
    let mut retry = tokio::time::interval(RETRY_EVERY);
    retry.tick().await;
    loop {
        let mut projects = BTreeSet::new();
        tokio::select! {
            got = changes.recv() => match got {
                Ok(change) => {
                    projects.insert(change.set.project_id.to_string());
                }
                // Events were missed: look at every project again.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    projects.extend(known.keys().cloned());
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            },
            _ = retry.tick() => {
                let Some(state) = weak.upgrade() else { return };
                if let Some(ctx) = context(&state) {
                    dispatcher.retry_due(&ctx).await;
                }
                continue;
            }
        }
        tokio::time::sleep(SETTLE).await;
        loop {
            match changes.try_recv() {
                Ok(change) => {
                    projects.insert(change.set.project_id.to_string());
                }
                Err(TryRecvError::Lagged(_)) => projects.extend(known.keys().cloned()),
                Err(_) => break,
            }
        }
        let Some(state) = weak.upgrade() else { return };
        let mut events = Vec::new();
        for project in projects {
            match current(&state, &project) {
                Some(now) => {
                    if let Some(before) = known.insert(project.clone(), now.clone()) {
                        events.extend(diff(&project, &before, &now));
                    }
                }
                None => {
                    known.remove(&project);
                }
            }
        }
        if events.is_empty() {
            continue;
        }
        if let Some(ctx) = context(&state) {
            dispatcher.deliver(&ctx, events).await;
        }
    }
}
