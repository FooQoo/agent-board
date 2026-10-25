//! The scripted steps of a run, and its finish, abort, and recovery.

use chrono::{DateTime, Utc};

use super::super::super::FileStore;
use super::super::super::onboarding_state::{
    self as state, GuideLocale, GuidePhase, GuideStatus, GuideTransition, OnboardingFile,
};
use super::{check_id, check_revision, conflict, invalid};
use crate::domain::ProjectId;
use crate::error::AgboardError;

impl FileStore {
    /// Move the run one step on. The step must follow from the current phase, and
    /// a repeated command returns the current state without changing anything.
    #[allow(clippy::too_many_arguments)]
    pub fn guide_advance(
        &self,
        project: &ProjectId,
        run_id: &str,
        client_id: &str,
        expected_revision: u64,
        command_id: &str,
        transition: GuideTransition,
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
            if !file.owned_by(client_id, now) || file.status != GuideStatus::Active {
                return Err(conflict("The guide run is not active for this tab."));
            }
            let run = file
                .run
                .clone()
                .filter(|run| run.run_id == run_id && run.project_id == project.to_string())
                .ok_or_else(|| conflict("This guide run is not the active one."))?;
            let [first, second] = match run.sample_ids.as_slice() {
                [a, b] => [*a, *b],
                _ => {
                    return Err(conflict(
                        "The guide's sample cards are not all created yet.",
                    ));
                }
            };
            let (phase, question) = match transition {
                GuideTransition::FirstRunning => {
                    if run.phase != GuidePhase::Samples {
                        return Err(invalid("The first card has already started."));
                    }
                    self.start_card(project, first, now)?;
                    (GuidePhase::FirstRunning, None)
                }
                GuideTransition::FirstDone => {
                    if run.phase != GuidePhase::FirstRunning {
                        return Err(invalid("The first card is not running."));
                    }
                    self.finish_card(project, first, now)?;
                    (GuidePhase::FirstDone, None)
                }
                GuideTransition::AskQuestion => {
                    if run.phase != GuidePhase::FirstDone {
                        return Err(invalid("The first card must finish before the question."));
                    }
                    let locale = GuideLocale::from_code(&run.locale)
                        .ok_or_else(|| invalid("The run's language is not known."))?;
                    let request_id = self.ask_card(project, second, locale, now)?;
                    (GuidePhase::Question, Some(request_id))
                }
                GuideTransition::ResumeSecond => {
                    if run.phase != GuidePhase::Question {
                        return Err(invalid("The question has not been asked."));
                    }
                    let request_id = run
                        .question_request_id
                        .clone()
                        .ok_or_else(|| invalid("The question has not been asked."))?;
                    if self.request_answer(project, second, &request_id)?.is_none() {
                        return Err(invalid("The answer is not saved yet."));
                    }
                    self.set_running(project, second, now)?;
                    (GuidePhase::SecondRunning, None)
                }
                GuideTransition::SecondDone => {
                    if run.phase != GuidePhase::SecondRunning {
                        return Err(invalid("The second card is not running."));
                    }
                    self.finish_card(project, second, now)?;
                    (GuidePhase::SecondDone, None)
                }
                GuideTransition::Complete => {
                    if run.phase != GuidePhase::SecondDone {
                        return Err(invalid(
                            "Both cards must finish before the guide completes.",
                        ));
                    }
                    (GuidePhase::Complete, None)
                }
            };
            let current = file.run.as_mut().expect("checked above");
            current.phase = phase;
            if let Some(request_id) = question {
                current.question_request_id = Some(request_id);
            }
            file.revision += 1;
            file.remember(command_id);
            state::write(shared, &file)?;
            Ok(file)
        })
    }

    /// Finish the run: archive its two cards and mark the guide completed.
    pub fn guide_finish(
        &self,
        project: &ProjectId,
        run_id: &str,
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
            if !file.owned_by(client_id, now) {
                return Err(conflict("This tab no longer holds the guide."));
            }
            let phase = file
                .run
                .as_ref()
                .filter(|run| run.run_id == run_id && run.project_id == project.to_string())
                .map(|run| run.phase)
                .ok_or_else(|| conflict("This guide run is not the active one."))?;
            if phase != GuidePhase::Complete && file.status != GuideStatus::Closing {
                return Err(invalid("The guide has not completed."));
            }
            file.status = GuideStatus::Closing;
            state::write(shared, &file)?;
            for id in self.run_samples(project, run_id)? {
                self.archive_task(project, id, now)?;
            }
            file.status = GuideStatus::Completed;
            file.owner = None;
            file.revision += 1;
            file.remember(command_id);
            state::write(shared, &file)?;
            Ok(file)
        })
    }

    /// End the run early: archive its cards and return the guide to "interrupted".
    /// The next project that is opened offers a new run from the beginning.
    pub fn guide_abort(
        &self,
        project: &ProjectId,
        run_id: &str,
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
            if !file.owned_by(client_id, now) {
                return Err(conflict("This tab no longer holds the guide."));
            }
            if !file
                .run
                .as_ref()
                .is_some_and(|run| run.run_id == run_id && run.project_id == project.to_string())
            {
                return Err(conflict("This guide run is not the active one."));
            }
            self.end_run_locked(&mut file, "Ended by the user.", now)?;
            file.remember(command_id);
            state::write(shared, &file)?;
            Ok(file)
        })
    }

    /// Take back a run whose tab is gone: its lease has expired, or no tab holds it.
    /// Returns whether anything changed. Called when the server starts, and by the
    /// recovery request.
    pub fn guide_recover(&self, now: DateTime<Utc>) -> Result<bool, AgboardError> {
        let shared = self.shared_dir();
        state::with_lock(shared, || {
            let mut file = state::read(shared)?;
            let running = matches!(file.status, GuideStatus::Active | GuideStatus::Closing);
            if !running || file.lease_is_live(now) {
                return Ok(false);
            }
            self.end_run_locked(&mut file, "Recovered after the tab was closed.", now)?;
            state::write(shared, &file)?;
            Ok(true)
        })
    }

    /// Archive the run's cards and mark the guide interrupted. Any failure leaves the
    /// guide "closing", so the next attempt finishes the same cleanup.
    pub(super) fn end_run_locked(
        &self,
        file: &mut OnboardingFile,
        reason: &str,
        now: DateTime<Utc>,
    ) -> Result<(), AgboardError> {
        let shared = self.shared_dir();
        let Some(run) = file.run.clone() else {
            file.status = GuideStatus::Interrupted;
            file.owner = None;
            file.revision += 1;
            return Ok(());
        };
        file.status = GuideStatus::Closing;
        if let Some(current) = file.run.as_mut() {
            current.closing_reason = Some(reason.to_string());
        }
        state::write(shared, file)?;
        let project: ProjectId = run
            .project_id
            .parse()
            .map_err(|_| conflict("The guide run names a project that cannot be read."))?;
        for id in self.run_samples(&project, &run.run_id)? {
            self.archive_task(&project, id, now)?;
        }
        file.status = GuideStatus::Interrupted;
        file.owner = None;
        file.revision += 1;
        state::write(shared, file)?;
        Ok(())
    }
}
