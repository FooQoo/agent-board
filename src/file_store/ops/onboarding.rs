//! The first-run guide's operations: the lease, the start of a run, the scripted
//! steps, and the finish, abort, and recovery that return the samples to the
//! archive. Every operation takes the guide's lock first, then the project lock
//! that the card operations take, and saves the guide's file once per change.

use chrono::{DateTime, Duration, Utc};

use super::super::frontmatter::{self, AcceptanceItem};
use super::super::io;
use super::super::model::Choice;
use super::super::onboarding_model::OnboardingSample;
use super::super::onboarding_state::{
    self as state, GuideLocale, GuideOwner, GuidePhase, GuideRun, GuideStatus, GuideTransition,
    LEASE_SECONDS, OnboardingFile,
};
use super::super::reader;
use super::super::{FileStore, TaskTextParts, validate};
use crate::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId, RunState};
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

    /// Create whichever of the two samples of the current run are missing. A card
    /// that exists with this run's identity is reused, never created again.
    fn ensure_samples_locked(
        &self,
        mut file: OnboardingFile,
        locale: GuideLocale,
        now: DateTime<Utc>,
    ) -> Result<OnboardingFile, AgboardError> {
        let shared = self.shared_dir();
        let project_id: ProjectId = file
            .run
            .as_ref()
            .ok_or_else(|| conflict("No guide run is active."))?
            .project_id
            .parse()
            .map_err(|_| conflict("The guide run names a project that cannot be read."))?;
        let (run_id, samples_known) = {
            let run = file.run.as_ref().expect("checked above");
            (run.run_id.clone(), run.sample_ids.clone())
        };
        let mut ids = samples_known;
        for ordinal in 1..=2u8 {
            if ids.len() >= usize::from(ordinal) {
                continue;
            }
            let id = match self.find_sample(&project_id, &run_id, ordinal)? {
                Some(id) => id,
                None => self.create_sample(&project_id, &run_id, ordinal, locale, now)?,
            };
            ids.push(id);
            file.run.as_mut().expect("checked above").sample_ids = ids.clone();
            file.revision += 1;
            state::write(shared, &file)?;
        }
        Ok(file)
    }

    fn create_sample(
        &self,
        project: &ProjectId,
        run_id: &str,
        ordinal: u8,
        locale: GuideLocale,
        now: DateTime<Utc>,
    ) -> Result<i64, AgboardError> {
        let (title, body, criterion) = sample_text(locale, ordinal);
        let items = [AcceptanceItem {
            id: SAMPLE_CRITERION.to_string(),
            text: criterion.to_string(),
            done: false,
        }];
        let text = frontmatter::compose(&validate::task_template(), body, Some(&items))
            .map_err(|defect| invalid(&defect.reason))?;
        let identity = OnboardingSample::new(run_id, ordinal).map_err(|reason| invalid(&reason))?;
        let view = self.create_task_with_identity(
            project,
            NewTask {
                title: title.to_string(),
                description: text,
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            now,
            Some(identity),
        )?;
        Ok(view.id)
    }

    /// The card of this run with the given ordinal, if it was created.
    fn find_sample(
        &self,
        project: &ProjectId,
        run_id: &str,
        ordinal: u8,
    ) -> Result<Option<i64>, AgboardError> {
        let shared = self.shared_dir();
        let project_dir = reader::project_dir_checked(shared, project)?;
        for id in reader::task_ids(&project_dir)? {
            let Ok(task) = reader::read_task_metadata_strict(shared, project, id) else {
                continue;
            };
            if let Some(sample) = task.onboarding_sample
                && sample.run_id == run_id
                && sample.ordinal == ordinal
            {
                return Ok(Some(id));
            }
        }
        Ok(None)
    }

    /// Every card of this run, wherever it is in the lanes.
    fn run_samples(&self, project: &ProjectId, run_id: &str) -> Result<Vec<i64>, AgboardError> {
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
                .is_some_and(|s| s.run_id == run_id)
            {
                ids.push(id);
            }
        }
        Ok(ids)
    }

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
    fn end_run_locked(
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

    /// Put the first card into Doing and Running, as the scripted run does.
    fn start_card(
        &self,
        project: &ProjectId,
        id: i64,
        now: DateTime<Utc>,
    ) -> Result<(), AgboardError> {
        let view = self.task(project, id)?;
        if view.task_status == Column::Todo {
            self.move_work_task(
                project,
                id,
                Column::Doing,
                ai_context("Guide: the first card starts."),
                now,
            )?;
        }
        self.set_running(project, id, now)
    }

    /// Put a card in Running, if it is not already.
    fn set_running(
        &self,
        project: &ProjectId,
        id: i64,
        now: DateTime<Utc>,
    ) -> Result<(), AgboardError> {
        let view = self.task(project, id)?;
        if view.agent_status != RunState::Running {
            self.set_agent_status(
                project,
                id,
                RunState::Running,
                ai_context("Guide: the card resumes."),
                None,
                now,
            )?;
        }
        Ok(())
    }

    /// Mark the card's one condition done; the existing completion moves it to Done.
    fn finish_card(
        &self,
        project: &ProjectId,
        id: i64,
        now: DateTime<Utc>,
    ) -> Result<(), AgboardError> {
        let view = self.task(project, id)?;
        if view.task_status != Column::Done {
            let items: Vec<AcceptanceItem> = view
                .acceptance
                .iter()
                .map(|item| AcceptanceItem {
                    id: item.id.clone(),
                    text: item.text.clone(),
                    done: true,
                })
                .collect();
            self.edit_task_parts(
                project,
                id,
                None,
                TaskTextParts {
                    body: None,
                    acceptance: Some(&items),
                },
                now,
            )?;
            self.auto_complete_project(project, now)?;
        }
        Ok(())
    }

    /// Move the second card to Doing and ask the question; returns the request ID.
    fn ask_card(
        &self,
        project: &ProjectId,
        id: i64,
        locale: GuideLocale,
        now: DateTime<Utc>,
    ) -> Result<String, AgboardError> {
        let view = self.task(project, id)?;
        if view.task_status == Column::Todo {
            self.move_work_task(
                project,
                id,
                Column::Doing,
                ai_context("Guide: the second card starts."),
                now,
            )?;
        }
        let (question, options) = question_text(locale);
        let choices = options
            .iter()
            .map(|(choice_id, label)| Choice {
                id: (*choice_id).to_string(),
                label: (*label).to_string(),
            })
            .collect();
        let changed = self.request_decision(project, id, Actor::Ai, question, choices, now)?;
        changed
            .value
            .pending_request_id
            .ok_or_else(|| conflict("The question was not recorded."))
    }
}

fn ai_context(reason: &str) -> ChangeContext {
    ChangeContext {
        actor: Actor::Ai,
        reason: reason.to_string(),
    }
}
