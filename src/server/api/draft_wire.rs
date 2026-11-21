//! The `draft` of a request body: `"human"`, or `null`. Any other value, `"ai"`
//! of earlier versions included, is rejected as an invalid body.

use serde::{Deserialize, Deserializer};

use crate::domain::Draft;

/// A `draft` that is present, `null` included, is `Some`; an absent one is `None`.
pub(super) fn present_draft<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<Draft>>, D::Error> {
    Option::<Draft>::deserialize(deserializer).map(Some)
}

/// A `draft` that names its owner (`"human"`) is `Some(Some(_))`. `null` and an
/// absent field are `None`.
pub(super) fn named_draft<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<Draft>>, D::Error> {
    Option::<Draft>::deserialize(deserializer).map(|wire| wire.map(Some))
}
