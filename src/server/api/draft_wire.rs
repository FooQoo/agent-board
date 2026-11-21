//! The `draft` of a request body.

use serde::{Deserialize, Deserializer};

use crate::domain::Draft;

/// The `draft` of a request as older clients send it: `"ai"` named a plan an
/// agent made. The plan is in the Backlog now, and "back to the plan" means
/// nobody holds the edit lock, which is what `null` says.
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum WireDraft {
    Human,
    Ai,
}

impl WireDraft {
    fn draft(self) -> Option<Draft> {
        match self {
            Self::Human => Some(Draft::Human),
            Self::Ai => None,
        }
    }
}

/// A `draft` that is present, `null` included, is `Some`; an absent one is `None`.
pub(super) fn present_draft<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<Draft>>, D::Error> {
    Option::<WireDraft>::deserialize(deserializer).map(|wire| Some(wire.and_then(WireDraft::draft)))
}

/// A `draft` of a task save, and whether an older client named it `"ai"`. The store
/// needs that flag to keep such a save from leaving a plan in Todo.
#[derive(Debug, Default, Clone, Copy)]
pub(super) struct NamedDraft {
    /// `Some` when the draft names its owner: `"human"`, or `"ai"` for the edit lock
    /// released. `null` and an absent one are `None`.
    pub(super) target: Option<Option<Draft>>,
    /// The client sent `"ai"`.
    pub(super) legacy_ai: bool,
}

pub(super) fn named_draft<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<NamedDraft, D::Error> {
    Option::<WireDraft>::deserialize(deserializer).map(|wire| NamedDraft {
        legacy_ai: matches!(wire, Some(WireDraft::Ai)),
        target: wire.map(WireDraft::draft),
    })
}

/// Like `named_draft`, but a `null` is present: it is `Some(None)`. Only an absent
/// field leaves `target` as `None`.
pub(super) fn present_named_draft<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<NamedDraft, D::Error> {
    Option::<WireDraft>::deserialize(deserializer).map(|wire| NamedDraft {
        legacy_ai: matches!(wire, Some(WireDraft::Ai)),
        target: Some(wire.and_then(WireDraft::draft)),
    })
}
