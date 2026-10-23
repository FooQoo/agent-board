//! The server's change feed: what the reloader found, numbered, for the SSE streams.
//!
//! Every change set gets the next `seq` of this server start, and the feed carries an
//! `instanceId` that is new at every start. A client that sees a `seq` gap, or a new
//! `instanceId`, knows it missed something and fetches the Summary again.

use std::sync::{Arc, Mutex};

use tokio::sync::broadcast;

use super::contracts::{Change, ChangeId, ChangeResource, Changed, Facet};
use crate::file_store::projection::{self, ChangeSet, ChangeSink, ResourceId};

/// How many change events a slow stream may fall behind before it is told to fetch everything.
const CAPACITY: usize = 256;

/// One change set with its number.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChangeEvent {
    pub seq: u64,
    pub set: ChangeSet,
}

struct Inner {
    instance_id: String,
    tx: broadcast::Sender<Arc<ChangeEvent>>,
    /// The last number given. Held while sending, so the numbers leave in order.
    seq: Mutex<u64>,
}

/// The feed that the reloader publishes to and the SSE streams subscribe to. Cheap to clone.
#[derive(Clone)]
pub(crate) struct ChangeFeed {
    inner: Arc<Inner>,
}

impl ChangeFeed {
    pub(crate) fn new() -> ChangeFeed {
        Self::with_capacity(CAPACITY)
    }

    pub(crate) fn with_capacity(capacity: usize) -> ChangeFeed {
        let mut bytes = [0u8; 8];
        let _ = getrandom::fill(&mut bytes);
        let instance_id = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let (tx, _) = broadcast::channel(capacity);
        ChangeFeed {
            inner: Arc::new(Inner {
                instance_id,
                tx,
                seq: Mutex::new(0),
            }),
        }
    }

    pub(crate) fn instance_id(&self) -> &str {
        &self.inner.instance_id
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<Arc<ChangeEvent>> {
        self.inner.tx.subscribe()
    }

    /// The number of the newest change event, 0 before the first.
    pub(crate) fn last_seq(&self) -> u64 {
        *self.inner.seq.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Number a change set and send it to every stream.
    pub(crate) fn publish(&self, set: ChangeSet) {
        if set.changes.is_empty() {
            return;
        }
        let mut seq = self.inner.seq.lock().unwrap_or_else(|e| e.into_inner());
        *seq += 1;
        let _ = self.inner.tx.send(Arc::new(ChangeEvent { seq: *seq, set }));
    }

    /// The sink the reloader sends to.
    pub(crate) fn sink(&self) -> ChangeSink {
        let feed = self.clone();
        ChangeSink::new(move |set| feed.publish(set))
    }

    /// The `changed` payload of an event.
    pub(crate) fn changed(&self, event: &ChangeEvent) -> Changed {
        Changed {
            instance_id: self.inner.instance_id.clone(),
            seq: event.seq,
            project_id: event.set.project_id.to_string(),
            changes: event.set.changes.iter().map(contract_change).collect(),
        }
    }
}

fn contract_change(change: &projection::ResourceChange) -> Change {
    Change {
        resource: match change.resource {
            projection::Resource::Task => ChangeResource::Task,
            projection::Resource::Epic => ChangeResource::Epic,
            projection::Resource::Project => ChangeResource::Project,
        },
        id: match &change.id {
            ResourceId::Task(id) => ChangeId::Task(*id),
            ResourceId::Named(name) => ChangeId::Named(name.clone()),
        },
        facets: change
            .facets
            .iter()
            .map(|facet| match facet {
                projection::Facet::Summary => Facet::Summary,
                projection::Facet::Document => Facet::Document,
                projection::Facet::History => Facet::History,
                projection::Facet::Deleted => Facet::Deleted,
            })
            .collect(),
    }
}

/// The data of the `resync` event: a stream that fell behind must fetch everything again. It
/// carries the newest `seq`, so the client can tell where the numbers stand now.
pub(crate) fn resync_data(feed: &ChangeFeed) -> String {
    serde_json::json!({"instanceId": feed.instance_id(), "seq": feed.last_seq()}).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_store::projection::{Facet as F, Resource, ResourceChange};

    fn set(task: i64) -> ChangeSet {
        ChangeSet {
            project_id: "0123456789abcdef0123456789abcdef".parse().unwrap(),
            changes: vec![ResourceChange {
                resource: Resource::Task,
                id: ResourceId::Task(task),
                facets: vec![F::Summary],
            }],
        }
    }

    #[test]
    fn numbers_grow_by_one_and_the_payload_follows_the_contract() {
        let feed = ChangeFeed::new();
        let mut rx = feed.subscribe();
        feed.publish(set(1));
        feed.publish(set(2));
        let first = rx.try_recv().unwrap();
        let second = rx.try_recv().unwrap();
        assert_eq!((first.seq, second.seq), (1, 2));
        let changed = feed.changed(&second);
        assert_eq!(changed.seq, 2);
        assert_eq!(changed.instance_id, feed.instance_id());
        assert_eq!(changed.problem(), None);
        assert_eq!(feed.last_seq(), 2);
    }

    #[test]
    fn an_empty_change_set_is_not_published() {
        let feed = ChangeFeed::new();
        let mut rx = feed.subscribe();
        feed.publish(ChangeSet {
            changes: Vec::new(),
            ..set(1)
        });
        assert!(rx.try_recv().is_err());
        assert_eq!(feed.last_seq(), 0);
    }

    #[test]
    fn two_starts_have_different_instance_ids() {
        assert_ne!(
            ChangeFeed::new().instance_id(),
            ChangeFeed::new().instance_id()
        );
    }
}
