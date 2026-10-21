//! The identity of the first-run guide's sample cards.
//!
//! A sample card carries `onboardingSample` from the moment it is created, so progress, hooks,
//! and `wait --until task` never select it, and it stays identified through archive, restore,
//! and history updates. Only the guide's own run writes this field; general create and edit
//! inputs have no way to set it.

use serde::{Deserialize, Serialize};

/// The run that created a sample card, and the card's place in that run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawOnboardingSample", rename_all = "camelCase")]
pub struct OnboardingSample {
    /// Lowercase hexadecimal, 32 characters.
    pub run_id: String,
    /// `1` or `2`: the guide creates exactly two sample cards per run.
    pub ordinal: u8,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawOnboardingSample {
    run_id: String,
    ordinal: u8,
}

impl TryFrom<RawOnboardingSample> for OnboardingSample {
    type Error = String;

    fn try_from(raw: RawOnboardingSample) -> Result<Self, Self::Error> {
        OnboardingSample::new(raw.run_id, raw.ordinal)
    }
}

impl OnboardingSample {
    /// Checks the run ID and the ordinal before the identity is stored.
    pub fn new(run_id: impl Into<String>, ordinal: u8) -> Result<Self, String> {
        let run_id = run_id.into();
        let well_formed = run_id.len() == 32
            && run_id
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
        if !well_formed {
            return Err(
                "onboardingSample.runId must be 32 lowercase hexadecimal characters".into(),
            );
        }
        if !matches!(ordinal, 1 | 2) {
            return Err("onboardingSample.ordinal must be 1 or 2".into());
        }
        Ok(Self { run_id, ordinal })
    }
}

/// Whether a card is one of the guide's samples. The title, the assignee, and the position
/// never decide this; only the stored identity does.
pub fn is_onboarding_sample(sample: Option<&OnboardingSample>) -> bool {
    sample.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_lowercase_run_id_and_ordinals_one_and_two() {
        let run = "0123456789abcdef0123456789abcdef";
        assert!(OnboardingSample::new(run, 1).is_ok());
        assert!(OnboardingSample::new(run, 2).is_ok());
    }

    #[test]
    fn rejects_other_run_ids_and_ordinals() {
        let run = "0123456789abcdef0123456789abcdef";
        assert!(OnboardingSample::new(run.to_uppercase(), 1).is_err());
        assert!(OnboardingSample::new(&run[1..], 1).is_err());
        assert!(OnboardingSample::new(run, 0).is_err());
        assert!(OnboardingSample::new(run, 3).is_err());
    }

    #[test]
    fn invalid_identity_is_refused_when_read() {
        let json = r#"{"runId":"not-a-run","ordinal":1}"#;
        assert!(serde_json::from_str::<OnboardingSample>(json).is_err());
    }
}
