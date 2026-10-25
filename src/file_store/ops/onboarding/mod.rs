//! The first-run guide's operations: the lease, the start of a run, the scripted
//! steps, and the finish, abort, and recovery that return the samples to the
//! archive. Every operation takes the guide's lock first, then the project lock
//! that the card operations take, and saves the guide's file once per change.

mod cards;
mod claim;
mod run;

use chrono::{DateTime, Duration, Utc};

use super::super::onboarding_state::{GuideLocale, LEASE_SECONDS, OnboardingFile};
use crate::domain::{Actor, ChangeContext};
use crate::error::AgboardError;

const SAMPLE_CRITERION: &str = "AC-1";

/// The two sample cards, in ordinal order, with their titles and bodies.
fn sample_text(locale: GuideLocale, ordinal: u8) -> (&'static str, &'static str, &'static str) {
    match (locale, ordinal) {
        (GuideLocale::Ja, 1) => (
            "サンプル：使い方を確認する",
            "ガイド用のサンプルです。実際のAIは動きません。",
            "サンプルの進行を確認する",
        ),
        (GuideLocale::Ja, _) => (
            "サンプル：案内の見せ方を選ぶ",
            "ガイド用のサンプルです。実際のAIは動きません。",
            "サンプルの回答を確認する",
        ),
        (GuideLocale::En, 1) => (
            "Sample: follow a task",
            "This is a guide sample. No AI agent works on it.",
            "Confirm the sample's progress",
        ),
        (GuideLocale::En, _) => (
            "Sample: choose the guide style",
            "This is a guide sample. No AI agent works on it.",
            "Confirm the sample's answer",
        ),
    }
}

fn question_text(locale: GuideLocale) -> (&'static str, [(&'static str, &'static str); 2]) {
    match locale {
        GuideLocale::Ja => (
            "案内の文章は、どちらが読みやすいですか？",
            [
                ("brief", "短く、要点だけ"),
                ("detailed", "背景も含めて詳しく"),
            ],
        ),
        GuideLocale::En => (
            "Which explanation is easier to read?",
            [
                ("brief", "Keep it brief"),
                ("detailed", "Include more context"),
            ],
        ),
    }
}

fn conflict(reason: &str) -> AgboardError {
    AgboardError::OnboardingConflict {
        reason: reason.to_string(),
    }
}

fn invalid(reason: &str) -> AgboardError {
    AgboardError::OnboardingInvalid {
        reason: reason.to_string(),
    }
}

/// The revision a command names must be the one the guide has now.
fn check_revision(file: &OnboardingFile, expected: u64) -> Result<(), AgboardError> {
    if file.revision != expected {
        return Err(conflict(
            "The guide changed since this tab read it. Read it again.",
        ));
    }
    Ok(())
}

fn check_id(value: &str, field: &str) -> Result<(), AgboardError> {
    let well_formed = !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if well_formed {
        Ok(())
    } else {
        Err(AgboardError::InvalidValue {
            field: field.into(),
            reason: "Use 1 to 64 letters, digits, hyphens, or underscores.".into(),
        })
    }
}

fn lease_until(now: DateTime<Utc>) -> DateTime<Utc> {
    now + Duration::seconds(LEASE_SECONDS)
}

fn ai_context(reason: &str) -> ChangeContext {
    ChangeContext {
        actor: Actor::Ai,
        reason: reason.to_string(),
    }
}
