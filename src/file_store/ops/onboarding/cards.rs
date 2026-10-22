//! The sample cards: creating and finding them, and the card steps of a run.

use chrono::{DateTime, Utc};

use super::super::super::frontmatter::{self, AcceptanceItem};
use super::super::super::model::Choice;
use super::super::super::onboarding_model::OnboardingSample;
use super::super::super::onboarding_state::{self as state, GuideLocale, OnboardingFile};
use super::super::super::reader;
use super::super::super::{FileStore, TaskTextParts, validate};
use super::{SAMPLE_CRITERION, ai_context, conflict, invalid, question_text, sample_text};
use crate::domain::{Actor, Assignee, Column, NewTask, ProjectId, RunState};
use crate::error::AgboardError;

impl FileStore {
    /// Create whichever of the two samples of the current run are missing. A card
    /// that exists with this run's identity is reused, never created again.
    pub(super) fn ensure_samples_locked(
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

    pub(super) fn create_sample(
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
    pub(super) fn find_sample(
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
    pub(super) fn run_samples(
        &self,
        project: &ProjectId,
        run_id: &str,
    ) -> Result<Vec<i64>, AgboardError> {
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

    /// Put the first card into Doing and Running, as the scripted run does.
    pub(super) fn start_card(
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
    pub(super) fn set_running(
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
    pub(super) fn finish_card(
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
    pub(super) fn ask_card(
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
