//! Adding questions to, or removing them from, the `questions` of a task.

use chrono::{DateTime, Utc};

use super::super::{ensure_ai_task_not_done, lock_project, stamp};
use super::broken_file_error;
use crate::domain::{Actor, ProjectId};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::frontmatter::compose_questions;
use crate::file_store::history::{ParseMode, parse_task};
use crate::file_store::model::{HistoryRecord, TaskView};
use crate::file_store::qa::QaIndex;
use crate::file_store::transaction::save_batch_locked;
use crate::file_store::{layout, reader};

impl FileStore {
    /// Add (`link`) or remove the questions `ids` in the task's `questions`. The guards are
    /// those of a TASK.md edit: an agent cannot change a Done, draft, or archived task.
    pub fn link_questions(
        &self,
        project: &ProjectId,
        task_id: i64,
        ids: &[String],
        link: bool,
        actor: Actor,
        now: DateTime<Utc>,
    ) -> Result<TaskView, AgboardError> {
        if ids.is_empty() {
            return Err(AgboardError::InvalidValue {
                field: "questions".into(),
                reason: "Name at least one question.".into(),
            });
        }
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, task_id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id: task_id });
        }
        if actor == Actor::Ai && task.is_draft {
            return Err(AgboardError::TaskIsDraft { id: task_id });
        }
        ensure_ai_task_not_done(&task, actor)?;
        if link {
            let index = QaIndex::load(shared, &project_dir)?;
            for id in ids {
                if index.find(id).is_none() {
                    return Err(broken_file_error(&index)
                        .unwrap_or(AgboardError::QuestionNotFound { id: id.clone() }));
                }
            }
        }
        let text = reader::read_body(shared, project, task_id)?;
        let label = layout::shared_label(
            shared,
            &layout::task_md(&layout::task_dir(&project_dir, task_id)),
        );
        let parsed = parse_task(&text, ParseMode::Stored);
        if let Some(d) = parsed.questions_defects.first() {
            return Err(AgboardError::FileInvalid {
                file: label,
                field: d.field.clone(),
                reason: d.reason.clone(),
            });
        }
        let mut current = parsed.questions.clone();
        let language = self.history_language(project, &task)?;
        let at = stamp(now);
        let mut changed = false;
        for id in ids {
            let present = current.contains(id);
            if link == present {
                continue;
            }
            if link {
                current.push(id.clone());
            } else {
                current.retain(|q| q != id);
            }
            changed = true;
            let (english, japanese) = if link {
                (
                    format!("Added question {id} to the references."),
                    format!("質問 {id} を参照に加えました。"),
                )
            } else {
                (
                    format!("Removed question {id} from the references."),
                    format!("質問 {id} を参照から外しました。"),
                )
            };
            task.history.push(HistoryRecord {
                at,
                reason: language.text(&english, &japanese).to_owned(),
            });
        }
        if changed {
            task.updated_at = at;
            let composed =
                compose_questions(&text, &current).map_err(|d| AgboardError::FileInvalid {
                    file: label,
                    field: d.field,
                    reason: d.reason,
                })?;
            let changes = super::super::save::task_pair_changes(
                shared,
                &project_dir,
                &task,
                Some(&composed),
            )?;
            save_batch_locked(&project_dir, changes)?;
        }
        reader::read_task_locked(shared, project, task_id)
    }
}
