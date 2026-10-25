//! The lease and the start of a guide run: claim, heartbeat, skip, and start.

use chrono::{DateTime, Utc};

use super::super::super::FileStore;
use super::super::super::io;
use super::super::super::onboarding_state::{
    self as state, GuideLocale, GuideOwner, GuidePhase, GuideRun, GuideStatus, OnboardingFile,
};
use super::{check_id, check_revision, conflict, lease_until};
use crate::domain::ProjectId;
use crate::error::AgboardError;

impl FileStore {
    /// The guide's state, read without writing anything.
    pub fn guide(&self) -> Result<OnboardingFile, AgboardError> {
        state::read(self.shared_dir())
    }

    /// Take the guide for `client_id` so that it can be shown in this tab. Only
    /// one tab holds it at a time. A guide that was interrupted can be offered
    /// again; a finished or skipped one is not.
    pub fn guide_claim(
        &self,
        client_id: &str,
        expected_revision: u64,
        now: DateTime<Utc>,
    ) -> Result<OnboardingFile, AgboardError> {
        self.claim_guide(client_id, expected_revision, now, false)
    }

    /// Take the guide again on request, from the settings. A finished or skipped
    /// guide is offered once more, and its next run creates two new samples just
    /// as the first run did.
    pub fn guide_replay(
        &self,
        client_id: &str,
        expected_revision: u64,
        now: DateTime<Utc>,
    ) -> Result<OnboardingFile, AgboardError> {
        self.claim_guide(client_id, expected_revision, now, true)
    }

    fn claim_guide(
        &self,
        client_id: &str,
        expected_revision: u64,
        now: DateTime<Utc>,
        replay: bool,
    ) -> Result<OnboardingFile, AgboardError> {
        check_id(client_id, "clientId")?;
        let shared = self.shared_dir();
        state::with_lock(shared, || {
            let mut file = state::read(shared)?;
            check_revision(&file, expected_revision)?;
            if file.lease_is_live(now) && !file.owned_by(client_id, now) {
                return Err(conflict("Another tab is showing the guide."));
            }
            if file.status == GuideStatus::Active {
                // The tab that ran the guide was reloaded or closed: the run is
                // taken back, as recovery would, before the guide is offered again.
                self.end_run_locked(&mut file, "Recovered after a reload.", now)?;
            }
            match file.status {
                GuideStatus::Unseen | GuideStatus::Interrupted | GuideStatus::Offered => {}
                GuideStatus::Completed | GuideStatus::Skipped if replay => {}
                GuideStatus::Closing => return Err(conflict("The guide is closing.")),
                GuideStatus::Active => return Err(conflict("A guide run is active.")),
                GuideStatus::Completed | GuideStatus::Skipped => {
                    return Err(conflict(
                        "The guide has already been shown in this data area.",
                    ));
                }
            }
            file.status = GuideStatus::Offered;
            file.owner = Some(GuideOwner {
                client_id: client_id.to_string(),
                lease_until: lease_until(now),
            });
            file.revision += 1;
            state::write(shared, &file)?;
            Ok(file)
        })
    }

    /// Keep the lease of the tab that holds the guide.
    pub fn guide_heartbeat(
        &self,
        client_id: &str,
        now: DateTime<Utc>,
    ) -> Result<OnboardingFile, AgboardError> {
        let shared = self.shared_dir();
        state::with_lock(shared, || {
            let mut file = state::read(shared)?;
            if !file.owned_by(client_id, now) {
                return Err(conflict("This tab no longer holds the guide."));
            }
            if let Some(owner) = file.owner.as_mut() {
                owner.lease_until = lease_until(now);
            }
            // A heartbeat only extends the lease; it does not change the revision.
            state::write(shared, &file)?;
            Ok(file)
        })
    }

    /// Mark the guide as skipped by the holder of the lease. Nothing is created.
    pub fn guide_skip(
        &self,
        client_id: &str,
        expected_revision: u64,
        command_id: &str,
        now: DateTime<Utc>,
    ) -> Result<OnboardingFile, AgboardError> {
        check_id(command_id, "commandId")?;
        let shared = self.shared_dir();
        state::with_lock(shared, || {
            let mut file = state::read(shared)?;
            if file.applied_commands.iter().any(|id| id == command_id) {
                return Ok(file);
            }
            check_revision(&file, expected_revision)?;
            if !file.owned_by(client_id, now) || file.status != GuideStatus::Offered {
                return Err(conflict("The guide is not offered to this tab."));
            }
            file.status = GuideStatus::Skipped;
            file.owner = None;
            file.revision += 1;
            file.remember(command_id);
            state::write(shared, &file)?;
            Ok(file)
        })
    }

    /// Start a run for `attempt_id`. A repeated start with the same attempt returns
    /// the same run and the same two cards, and a partly created run is completed
    /// rather than duplicated.
    pub fn guide_start(
        &self,
        project: &ProjectId,
        client_id: &str,
        attempt_id: &str,
        expected_revision: u64,
        locale: GuideLocale,
        now: DateTime<Utc>,
    ) -> Result<OnboardingFile, AgboardError> {
        check_id(attempt_id, "attemptId")?;
        let shared = self.shared_dir();
        state::with_lock(shared, || {
            let mut file = state::read(shared)?;
            if let Some(run) = file.run.clone()
                && file.status == GuideStatus::Active
                && run.attempt_id == attempt_id
                && run.project_id == project.to_string()
            {
                {
                    if !file.owned_by(client_id, now) {
                        return Err(conflict("This tab no longer holds the guide."));
                    }
                    // Same attempt again: finish creating the cards, if any are missing.
                    return self.ensure_samples_locked(file, locale, now);
                }
            }
            check_revision(&file, expected_revision)?;
            if file.status != GuideStatus::Offered || !file.owned_by(client_id, now) {
                return Err(conflict("The guide is not offered to this tab."));
            }
            // The run is recorded before any card is written, so a crash after this
            // point leaves a run that the next start can finish or recover.
            let run_id =
                io::random_hex(16).map_err(|error| io::write_error("onboarding.json", error))?;
            file.run = Some(GuideRun {
                run_id,
                attempt_id: attempt_id.to_string(),
                project_id: project.to_string(),
                locale: locale.code().to_string(),
                created_at: now,
                sample_ids: Vec::new(),
                phase: GuidePhase::Samples,
                question_request_id: None,
                closing_reason: None,
            });
            file.status = GuideStatus::Active;
            file.applied_commands.clear();
            file.revision += 1;
            state::write(shared, &file)?;
            self.ensure_samples_locked(file, locale, now)
        })
    }
}
