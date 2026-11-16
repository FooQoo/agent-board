//! The first-run guide's one stored fact: whether this data area has seen it.
//! Every operation takes the guide's lock, and the lock is held while a leftover
//! version 1 run's sample cards are archived and the file is rewritten.

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::onboarding_state::{self as state, GuideOutcome, Loaded, OnboardingFile};
use super::super::reader;
use crate::domain::ProjectId;
use crate::error::AgboardError;

impl FileStore {
    /// The guide's state. A version 1 file is upgraded first, so a read never shows
    /// sample cards from an older release.
    pub fn guide(&self, now: DateTime<Utc>) -> Result<OnboardingFile, AgboardError> {
        let shared = self.shared_dir();
        if !state::state_file(shared).exists() {
            return Ok(OnboardingFile::fresh());
        }
        state::with_lock(shared, || self.load_guide_locked(now))
    }

    /// Record how the guide ended. A later call replaces the earlier outcome.
    pub fn guide_seen(
        &self,
        outcome: GuideOutcome,
        now: DateTime<Utc>,
    ) -> Result<OnboardingFile, AgboardError> {
        let shared = self.shared_dir();
        state::with_lock(shared, || {
            self.load_guide_locked(now)?;
            let file = OnboardingFile::with_status(outcome.into());
            state::write(shared, &file)?;
            Ok(file)
        })
    }

    /// Upgrade a version 1 file when the server starts.
    pub fn guide_upgrade(&self, now: DateTime<Utc>) -> Result<(), AgboardError> {
        self.guide(now).map(|_| ())
    }

    /// Read the file; for a version 1 file, archive the sample cards of its open
    /// run and rewrite it as version 2. A failure while archiving leaves the old
    /// file in place, so the next read finishes the same cleanup.
    fn load_guide_locked(&self, now: DateTime<Utc>) -> Result<OnboardingFile, AgboardError> {
        let shared = self.shared_dir();
        let Loaded {
            file,
            legacy_run,
            legacy,
        } = state::read(shared)?;
        if !legacy {
            return Ok(file);
        }
        if let Some(run) = legacy_run
            && let Ok(project) = run.project_id.parse::<ProjectId>()
            && reader::project_dir_checked(shared, &project).is_ok()
        {
            for id in self.legacy_samples(&project, &run.run_id)? {
                self.archive_task(&project, id, now)?;
            }
        }
        state::write(shared, &file)?;
        Ok(file)
    }

    /// Every card that an older release created for this run, wherever it is.
    fn legacy_samples(&self, project: &ProjectId, run_id: &str) -> Result<Vec<i64>, AgboardError> {
        let shared = self.shared_dir();
        let project_dir = reader::project_dir_checked(shared, project)?;
        let mut ids = Vec::new();
        for id in reader::task_ids(&project_dir)? {
            let Ok(task) = reader::read_task_metadata_strict(shared, project, id) else {
                continue;
            };
            if task
                .onboarding_sample
                .as_ref()
                .is_some_and(|sample| sample.run_id == run_id)
            {
                ids.push(id);
            }
        }
        Ok(ids)
    }
}
