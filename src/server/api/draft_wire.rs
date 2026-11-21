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

/// A `draft` that names its owner (`"human"`, or `"ai"` for the edit lock
/// released) is `Some`; `null` and an absent one are `None`.
pub(super) fn named_draft<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<Draft>>, D::Error> {
    Option::<WireDraft>::deserialize(deserializer).map(|wire| wire.map(WireDraft::draft))
}
