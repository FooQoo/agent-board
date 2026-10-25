//! The first-run guide's state: one file for the whole shared directory,
//! `shared/.internal/onboarding.json`. It records whether the guide has been
//! offered, skipped, or completed, which run is active, which tab owns the
//! guide's lease, and which commands were applied, so that a retry or a lost
//! response never repeats a step.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::io;
use super::lock::WriteLock;
use crate::error::AgboardError;

/// The only format this build reads and writes.
pub const STATE_FORMAT_VERSION: u32 = 1;
/// How long a tab keeps the guide's lease without a heartbeat.
pub const LEASE_SECONDS: i64 = 30;
/// Recent command IDs kept for replay; older ones are no longer repeated.
pub const APPLIED_LIMIT: usize = 64;

pub fn state_file(shared: &Path) -> PathBuf {
    shared.join(".internal").join("onboarding.json")
}

pub fn state_lock(shared: &Path) -> PathBuf {
    shared.join(".internal").join("onboarding.lock")
}

/// The guide's global status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GuideStatus {
    Unseen,
    Offered,
    Active,
    Closing,
    Completed,
    Interrupted,
    Skipped,
}

/// The step of the scripted run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GuidePhase {
    Samples,
    FirstRunning,
    FirstDone,
    Question,
    SecondRunning,
    SecondDone,
    Complete,
}

/// The tab that holds the guide, and until when its lease is valid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GuideOwner {
    pub client_id: String,
    #[serde(with = "crate::clock::serde_utc")]
    pub lease_until: DateTime<Utc>,
}

/// One run of the guide: its two sample cards and the step it has reached.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GuideRun {
    pub run_id: String,
    pub attempt_id: String,
    pub project_id: String,
    /// `en` or `ja`: the language the sample cards and the question were written in.
    pub locale: String,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    /// The sample cards created so far, in ordinal order.
    pub sample_ids: Vec<i64>,
    pub phase: GuidePhase,
    /// The request ID of the second sample's question, once it is asked.
    pub question_request_id: Option<String>,
    pub closing_reason: Option<String>,
}

/// `onboarding.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OnboardingFile {
    pub format_version: u32,
    /// Increases with every saved change; a command names the revision it saw.
    pub revision: u64,
    pub status: GuideStatus,
    pub owner: Option<GuideOwner>,
    pub run: Option<GuideRun>,
    pub applied_commands: Vec<String>,
}

impl OnboardingFile {
    /// The state of a data area that has never shown the guide.
    pub fn fresh() -> OnboardingFile {
        OnboardingFile {
            format_version: STATE_FORMAT_VERSION,
            revision: 0,
            status: GuideStatus::Unseen,
            owner: None,
            run: None,
            applied_commands: Vec::new(),
        }
    }

    /// Whether `client_id` holds a lease that is still valid at `now`.
    pub fn owned_by(&self, client_id: &str, now: DateTime<Utc>) -> bool {
        self.owner
            .as_ref()
            .is_some_and(|owner| owner.client_id == client_id && owner.lease_until > now)
    }

    /// Whether a lease exists and is still valid at `now`, for any tab.
    pub fn lease_is_live(&self, now: DateTime<Utc>) -> bool {
        self.owner
            .as_ref()
            .is_some_and(|owner| owner.lease_until > now)
    }

    /// Remember a command as applied, keeping only the most recent ones.
    pub fn remember(&mut self, command_id: &str) {
        self.applied_commands.push(command_id.to_string());
        let excess = self.applied_commands.len().saturating_sub(APPLIED_LIMIT);
        self.applied_commands.drain(..excess);
    }
}

/// Read the state; a data area without the file has never shown the guide.
pub fn read(shared: &Path) -> Result<OnboardingFile, AgboardError> {
    let path = state_file(shared);
    let label = super::layout::shared_label(shared, &path);
    if !path.exists() {
        return Ok(OnboardingFile::fresh());
    }
    let text = io::read_text(&path, &label)?;
    let file: OnboardingFile =
        serde_json::from_str(&text).map_err(|error| io::read_error(&label, error))?;
    if file.format_version != STATE_FORMAT_VERSION {
        return Err(io::read_error(
            &label,
            format!("unsupported format version {}", file.format_version),
        ));
    }
    Ok(file)
}

/// Save the state atomically.
pub fn write(shared: &Path, file: &OnboardingFile) -> Result<(), AgboardError> {
    let path = state_file(shared);
    let label = super::layout::shared_label(shared, &path);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|error| io::write_error(&label, error))?;
    }
    io::write_json(&path, file, &label)
}

/// Run `action` while holding the guide's lock. The guide's lock is taken before
/// any project lock, so an operation may take a project lock inside it.
pub fn with_lock<T>(
    shared: &Path,
    action: impl FnOnce() -> Result<T, AgboardError>,
) -> Result<T, AgboardError> {
    let lock_path = state_lock(shared);
    if let Some(dir) = lock_path.parent() {
        std::fs::create_dir_all(dir).map_err(|error| {
            io::write_error(&super::layout::shared_label(shared, &lock_path), error)
        })?;
    }
    let _lock = WriteLock::acquire(&lock_path)?;
    action()
}

/// The language of the sample cards and the question, from the board's language.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GuideLocale {
    En,
    Ja,
}

impl GuideLocale {
    /// The language code kept in the run: `en` or `ja`.
    pub fn code(self) -> &'static str {
        match self {
            GuideLocale::En => "en",
            GuideLocale::Ja => "ja",
        }
    }

    pub fn from_code(code: &str) -> Option<GuideLocale> {
        match code {
            "en" => Some(GuideLocale::En),
            "ja" => Some(GuideLocale::Ja),
            _ => None,
        }
    }
}

/// One step of the run, named as the client asks for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GuideTransition {
    FirstRunning,
    FirstDone,
    AskQuestion,
    ResumeSecond,
    SecondDone,
    Complete,
}
