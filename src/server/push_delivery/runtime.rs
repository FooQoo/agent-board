//! The task that follows the change feed and hands each change to the dispatcher.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::str::FromStr;
use std::sync::{Arc, Weak};
use std::time::Duration;

use tokio::sync::broadcast::error::TryRecvError;

use super::deliver::{Context, Dispatcher, NowFn};
use super::events::{Event, ProjectFacts, diff, project_facts};
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

/// Whether the remote entrance is up right now.
fn entrance_up(state: &AppState) -> bool {
    state.monitor.public_origin().is_some()
}

/// What delivery works with right now, or `None` when no device is subscribed. A change seen
/// while the entrance was down (`up_at_change` is false) gets no address even when the entrance
/// has come back since, so it is skipped rather than sent late.
fn context(state: &AppState, up_at_change: bool) -> Option<Context> {
    let subscriptions = state.monitor.push_subscriptions();
    if subscriptions.is_empty() {
        return None;
    }
    Some(Context {
        store: state.monitor.push_store().clone(),
        subscriptions,
        origin: state.monitor.public_origin().filter(|_| up_at_change),
        settings: state.notification_settings.load(),
        lang: Lang::from_locale(&state.preferences.load().locale),
    })
}

/// Follow the board's changes and send the notifications they call for. The task ends with the
/// server (or when the change feed closes).
pub(crate) fn start(state: &Arc<AppState>, data_dir: &Path, transport: Arc<dyn PushTransport>) {
    let now: NowFn = Arc::new(chrono::Utc::now);
    let dispatcher = Arc::new(Dispatcher::new(Ledger::open(data_dir), transport, now));
    let known = baseline(state);
    let changes = state.changed.subscribe();
    let weak = Arc::downgrade(state);
    tokio::spawn(retry_loop(weak.clone(), dispatcher.clone()));
    tokio::spawn(follow(weak, changes, known, dispatcher));
}

/// The projects a batch of changes touched, each with whether the entrance was up when its
/// latest change was seen. A project seen while the entrance was down stays down for the batch.
type Seen = BTreeMap<String, bool>;

fn note(seen: &mut Seen, project: String, up: bool) {
    let slot = seen.entry(project).or_insert(true);
    *slot = *slot && up;
}

/// Split events by whether the entrance was up when their project changed.
fn split_by_entrance(events: Vec<Event>, seen: &Seen) -> (Vec<Event>, Vec<Event>) {
    events
        .into_iter()
        .partition(|e| seen.get(&e.project).copied().unwrap_or(false))
}

/// Looks at the failed sends on its own task, so a slow push service holds up neither the
/// change feed nor the next pass: a pass ends before the next one starts.
async fn retry_loop(weak: Weak<AppState>, dispatcher: Arc<Dispatcher>) {
    let mut retry = tokio::time::interval(RETRY_EVERY);
    retry.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    retry.tick().await;
    loop {
        retry.tick().await;
        let ctx = {
            let Some(state) = weak.upgrade() else { return };
            context(&state, true)
        };
        if let Some(ctx) = ctx {
            dispatcher.retry_due(&ctx).await;
        }
    }
}

async fn follow(
    weak: Weak<AppState>,
    mut changes: tokio::sync::broadcast::Receiver<Arc<crate::server::change_feed::ChangeEvent>>,
    mut known: Known,
    dispatcher: Arc<Dispatcher>,
) {
    let up_now = |weak: &Weak<AppState>| weak.upgrade().is_some_and(|s| entrance_up(&s));
    loop {
        let mut seen = Seen::new();
        match changes.recv().await {
            // Taken when the change is seen, before the settle wait and before any delivery:
            // a change made while the entrance was down is never sent.
            Ok(change) => note(&mut seen, change.set.project_id.to_string(), up_now(&weak)),
            // Events were missed: look at every project again.
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                let up = up_now(&weak);
                known.keys().for_each(|p| note(&mut seen, p.clone(), up));
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
        }
        tokio::time::sleep(SETTLE).await;
        loop {
            match changes.try_recv() {
                Ok(change) => note(&mut seen, change.set.project_id.to_string(), up_now(&weak)),
                Err(TryRecvError::Lagged(_)) => {
                    let up = up_now(&weak);
                    known.keys().for_each(|p| note(&mut seen, p.clone(), up));
                }
                Err(_) => break,
            }
        }
        let Some(state) = weak.upgrade() else { return };
        let mut events = Vec::new();
        for project in seen.keys() {
            match current(&state, project) {
                Some(now) => {
                    if let Some(before) = known.insert(project.clone(), now.clone()) {
                        events.extend(diff(project, &before, &now));
                    }
                }
                None => {
                    known.remove(project);
                }
            }
        }
        let (up, down) = split_by_entrance(events, &seen);
        for (events, up_at_change) in [(up, true), (down, false)] {
            if events.is_empty() {
                continue;
            }
            if let Some(ctx) = context(&state, up_at_change) {
                // Sent on its own task, so a slow push service never delays seeing the next change.
                let dispatcher = dispatcher.clone();
                tokio::spawn(async move { dispatcher.deliver(&ctx, events).await });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::push_delivery::events::Kind;

    fn event(project: &str) -> Event {
        Event {
            project: project.into(),
            task: 1,
            title: String::new(),
            kind: Kind::History,
            key: project.into(),
            version: None,
            detail: String::new(),
        }
    }

    #[test]
    fn each_project_keeps_the_entrance_state_of_its_own_change() {
        let mut seen = Seen::new();
        note(&mut seen, "a".into(), false);
        note(&mut seen, "b".into(), true);
        // A later change in the same project does not make an earlier offline one sendable.
        note(&mut seen, "a".into(), true);
        let (up, down) = split_by_entrance(vec![event("a"), event("b"), event("c")], &seen);
        assert_eq!(
            up.iter().map(|e| e.project.as_str()).collect::<Vec<_>>(),
            ["b"]
        );
        assert_eq!(
            down.iter().map(|e| e.project.as_str()).collect::<Vec<_>>(),
            ["a", "c"]
        );
    }
}
