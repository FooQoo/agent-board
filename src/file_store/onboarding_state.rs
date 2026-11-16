//! The first-run guide's state: one file for the whole shared directory,
//! `shared/.internal/onboarding.json`. It records only whether this data area has
//! already seen the guide, and how it ended. The guide itself runs in the web UI.
//!
//! Releases before this format kept a whole run in the file (a tab lease, sample
//! cards, applied commands). [`read`] maps such a version 1 file to the three
//! statuses below, and [`legacy_run`] names the sample cards it may have left behind.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::io;
use super::lock::WriteLock;
use crate::error::AgboardError;

/// The only format this build writes.
pub const STATE_FORMAT_VERSION: u32 = 2;
const LEGACY_FORMAT_VERSION: u32 = 1;

pub fn state_file(shared: &Path) -> PathBuf {
    shared.join(".internal").join("onboarding.json")
}

pub fn state_lock(shared: &Path) -> PathBuf {
    shared.join(".internal").join("onboarding.lock")
}

/// Whether this data area has seen the guide, and how it ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GuideStatus {
    Unseen,
    Completed,
    Skipped,
}

/// How a person left the guide.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GuideOutcome {
    Completed,
    Skipped,
}

impl From<GuideOutcome> for GuideStatus {
    fn from(outcome: GuideOutcome) -> GuideStatus {
        match outcome {
            GuideOutcome::Completed => GuideStatus::Completed,
            GuideOutcome::Skipped => GuideStatus::Skipped,
        }
    }
}

/// `onboarding.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OnboardingFile {
    pub format_version: u32,
    pub status: GuideStatus,
}

impl OnboardingFile {
    /// The state of a data area that has never shown the guide.
    pub fn fresh() -> OnboardingFile {
        OnboardingFile::with_status(GuideStatus::Unseen)
    }

    pub fn with_status(status: GuideStatus) -> OnboardingFile {
        OnboardingFile {
            format_version: STATE_FORMAT_VERSION,
            status,
        }
    }
}

/// The sample cards a version 1 file may have left in a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyRun {
    pub project_id: String,
    pub run_id: String,
}

/// What a read found: the state, and the leftover run of a version 1 file whose
/// sample cards have not been archived yet.
pub struct Loaded {
    pub file: OnboardingFile,
    pub legacy_run: Option<LegacyRun>,
    /// Whether the file on disk is a version 1 file that still needs rewriting.
    pub legacy: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyFile {
    format_version: u32,
    status: String,
    run: Option<LegacyRunFields>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRunFields {
    project_id: String,
    run_id: String,
    #[serde(default)]
    sample_ids: Vec<i64>,
}

/// Read the state; a data area without the file has never shown the guide.
pub fn read(shared: &Path) -> Result<Loaded, AgboardError> {
    let path = state_file(shared);
    let label = super::layout::shared_label(shared, &path);
    if !path.exists() {
        return Ok(Loaded {
            file: OnboardingFile::fresh(),
            legacy_run: None,
            legacy: false,
        });
    }
    let text = io::read_text(&path, &label)?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| io::read_error(&label, error))?;
    match value.get("formatVersion").and_then(|v| v.as_u64()) {
        Some(version) if version == u64::from(STATE_FORMAT_VERSION) => {
            let file: OnboardingFile =
                serde_json::from_value(value).map_err(|error| io::read_error(&label, error))?;
            Ok(Loaded {
                file,
                legacy_run: None,
                legacy: false,
            })
        }
        Some(version) if version == u64::from(LEGACY_FORMAT_VERSION) => {
            let old: LegacyFile =
                serde_json::from_value(value).map_err(|error| io::read_error(&label, error))?;
            debug_assert_eq!(old.format_version, LEGACY_FORMAT_VERSION);
            let status = match old.status.as_str() {
                "completed" => GuideStatus::Completed,
                "skipped" => GuideStatus::Skipped,
                _ => GuideStatus::Unseen,
            };
            // Only a run that was still open can have left sample cards in a lane.
            let open = matches!(
                old.status.as_str(),
                "offered" | "active" | "closing" | "interrupted"
            );
            let legacy_run = old
                .run
                .filter(|run| open && !run.sample_ids.is_empty())
                .map(|run| LegacyRun {
                    project_id: run.project_id,
                    run_id: run.run_id,
                });
            Ok(Loaded {
                file: OnboardingFile::with_status(status),
                legacy_run,
                legacy: true,
            })
        }
        other => Err(io::read_error(
            &label,
            format!(
                "unsupported format version {}",
                other.map_or("(missing)".to_string(), |v| v.to_string())
            ),
        )),
    }
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
