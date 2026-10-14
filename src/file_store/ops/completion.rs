//! Automatic completion when every valid acceptance condition is checked.

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::frontmatter;
use super::super::reader;
use super::HistoryKind;
use super::{Transition, lane_end, lock_project, save_task, stamp, transition_event};
use crate::domain::{Column, ProjectId, RunState};
use crate::error::AgboardError;

const AUTO_DONE_REASON: &str = "All acceptance conditions are complete.";

impl FileStore {
    /// Complete every eligible card in every project. Used before the serve
    /// publishes its first snapshot, so existing work is reconciled on startup.
    pub(crate) fn auto_complete_all(&self, now: DateTime<Utc>) -> Result<bool, AgboardError> {
        let mut changed = false;
        for project in self.projects()? {
            changed |= self.auto_complete_project(&project.id, now)?;
        }
        Ok(changed)
    }

    /// Recheck the latest card files while holding the project write lock.
    /// Invalid or ineligible cards are left alone; moving a card to Done makes
    /// subsequent watch notifications idempotent.
    pub(crate) fn auto_complete_project(
        &self,
        project: &ProjectId,
        now: DateTime<Utc>,
    ) -> Result<bool, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut changed = false;

        for id in reader::card_ids(&project_dir)? {
            let Ok(loaded) = reader::read_card_lenient(shared, project, id) else {
                continue;
            };
            let card = loaded.view;
            if card.assignee != crate::domain::Assignee::Ai
                || card.is_draft
                || card.archived_at.is_some()
                || !matches!(card.card_status, Column::Todo | Column::Doing)
                || card.agent_status == RunState::Pending
                || card.acceptance_error
                || card.acceptance.is_empty()
                || card.acceptance.iter().any(|item| !item.done)
            {
                continue;
            }

            // Re-read under the lock rather than relying on a prior snapshot.
            let Ok(mut task) = reader::read_task_strict(shared, project, id) else {
                continue;
            };
            let text = match reader::read_body(shared, project, id) {
                Ok(text) => text,
                Err(_) => continue,
            };
            let parsed = frontmatter::parse(&text);
            if !parsed.defects.is_empty()
                || parsed.acceptance.is_empty()
                || parsed.acceptance.iter().any(|item| !item.done)
                || task.assignee != crate::domain::Assignee::Ai
                || task.is_draft
                || task.archived_at.is_some()
                || !matches!(task.card_status, Column::Todo | Column::Doing)
                || task.agent_status == RunState::Pending
            {
                continue;
            }

            let at = stamp(now);
            let position = lane_end(shared, project, Column::Done)?;
            let event = transition_event(Transition {
                kind: HistoryKind::Lane,
                reason: Some(AUTO_DONE_REASON),
                from_card: Some(task.card_status),
                to_card: Column::Done,
                from_agent: Some(task.agent_status),
                to_agent: RunState::Idle,
                at,
            })?;
            if task.agent_status != RunState::Idle {
                task.agent_status_changed_at = at;
            }
            task.card_status = Column::Done;
            task.card_status_changed_at = at;
            task.agent_status = RunState::Idle;
            task.pending_request_id = None;
            task.pending_request = None;
            task.position = position;
            task.updated_at = at;
            task.history.push(event);
            save_task(shared, &project_dir, &task)?;
            changed = true;
        }
        Ok(changed)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use chrono::{TimeZone, Utc};

    use crate::domain::{Actor, Assignee, ChangeContext, Column, NewCard, ProjectId, RunState};
    use crate::file_store::FileStore;

    fn at(day: u32) -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, day, 0, 0, 0).unwrap()
    }

    const OPEN: &str = "---\nacceptance:\n  - id: AC-1\n    text: First\n    done: true\n  - id: AC-2\n    text: Second\n    done: false\n---\n\nWork.\n";
    const COMPLETE: &str = "---\nacceptance:\n  - id: AC-1\n    text: First\n    done: true\n  - id: AC-2\n    text: Second\n    done: true\n---\n\nWork.\n";

    struct Fixture {
        _root: tempfile::TempDir,
        store: FileStore,
        project: ProjectId,
    }

    impl Fixture {
        fn new() -> Self {
            let root = tempfile::tempdir().unwrap();
            let store = FileStore::open(&root.path().join("shared"));
            let project = store.create_project("Alpha", at(1)).unwrap().id;
            Self {
                _root: root,
                store,
                project,
            }
        }

        fn card(&self, name: &str, assignee: Assignee, body: &str, draft: bool) -> i64 {
            self.store
                .create_card(
                    &self.project,
                    NewCard {
                        title: name.into(),
                        description: body.into(),
                        assignee,
                        actor: Actor::Ai,
                        is_draft: draft,
                    },
                    at(1),
                )
                .unwrap()
                .id
        }

        fn path(&self, id: i64) -> PathBuf {
            self.store
                .shared_dir()
                .join("projects")
                .join(self.project.as_str())
                .join("tasks")
                .join(id.to_string())
                .join("TASK.md")
        }

        fn replace_description(&self, id: i64, description: &str) {
            let path = self.path(id);
            let current = std::fs::read_to_string(&path).unwrap();
            let stored = super::super::super::history::parse_task(
                &current,
                super::super::super::history::ParseMode::Stored,
            );
            let input = super::super::super::history::parse_task(
                description,
                super::super::super::history::ParseMode::NewInput,
            );
            let next = super::super::super::history::compose_task(
                description,
                &input.body,
                Some(&input.acceptance),
                &stored.history,
            )
            .unwrap();
            std::fs::write(path, next).unwrap();
        }
    }

    #[test]
    fn completed_ai_todo_moves_once_and_records_a_reasoned_lane_event() {
        let f = Fixture::new();
        let id = f.card("Complete", Assignee::Ai, COMPLETE, false);

        assert!(f.store.auto_complete_all(at(2)).unwrap());
        assert!(!f.store.auto_complete_all(at(3)).unwrap());

        let card = f.store.card(&f.project, id).unwrap();
        assert_eq!(card.card_status, Column::Done);
        assert_eq!(card.agent_status, RunState::Idle);
        let completed: Vec<_> = card
            .history
            .iter()
            .filter(|e| e.reason == super::AUTO_DONE_REASON)
            .collect();
        assert_eq!(completed.len(), 1);
        assert!(!completed[0].reason.is_empty());
    }

    #[test]
    fn only_valid_nonempty_fully_done_ai_conditions_are_eligible() {
        let f = Fixture::new();
        let open = f.card("Open", Assignee::Ai, OPEN, false);
        let human = f.card("Human", Assignee::Human, COMPLETE, false);
        let draft = f.card("Draft", Assignee::Ai, COMPLETE, true);
        let none = f.card(
            "None",
            Assignee::Ai,
            "---\nacceptance: []\n---\n\nWork.\n",
            false,
        );
        let invalid = f.card("Invalid", Assignee::Ai, OPEN, false);
        let valid = std::fs::read_to_string(f.path(invalid)).unwrap();
        let (_, history) = valid.split_once("history:").unwrap();
        std::fs::write(
            f.path(invalid),
            format!("---\nacceptance: nope\nhistory:{history}"),
        )
        .unwrap();

        f.store.auto_complete_all(at(2)).unwrap();

        for id in [open, human, draft, none, invalid] {
            assert_ne!(
                f.store.card(&f.project, id).unwrap().card_status,
                Column::Done
            );
        }
    }

    #[test]
    fn pending_is_left_alone_then_answered_card_is_reconsidered() {
        let f = Fixture::new();
        let id = f.card("Pending", Assignee::Ai, COMPLETE, false);
        f.store
            .move_work_card(
                &f.project,
                id,
                Column::Doing,
                ChangeContext {
                    actor: Actor::Ai,
                    reason: "Start".into(),
                },
                at(2),
            )
            .unwrap();
        let pending = f
            .store
            .request_decision(
                &f.project,
                id,
                Actor::Ai,
                "Question",
                vec![
                    crate::file_store::model::Choice {
                        id: "a".into(),
                        label: "A".into(),
                    },
                    crate::file_store::model::Choice {
                        id: "b".into(),
                        label: "B".into(),
                    },
                ],
                at(3),
            )
            .unwrap()
            .value;

        f.store.auto_complete_all(at(4)).unwrap();
        assert_eq!(
            f.store.card(&f.project, id).unwrap().agent_status,
            RunState::Pending
        );
        f.store
            .answer_request(
                &f.project,
                id,
                pending.pending_request_id.as_deref().unwrap(),
                crate::file_store::Answer {
                    actor: Actor::Human,
                    choice_id: Some("a".into()),
                    text: None,
                },
                at(5),
            )
            .unwrap();
        f.store.auto_complete_all(at(6)).unwrap();

        let card = f.store.card(&f.project, id).unwrap();
        assert_eq!(card.card_status, Column::Done);
        assert_eq!(card.agent_status, RunState::Idle);
    }

    #[test]
    fn direct_task_file_updates_are_rechecked_and_existing_done_is_not_reopened() {
        let f = Fixture::new();
        let id = f.card("Edited externally", Assignee::Ai, OPEN, false);
        f.replace_description(id, COMPLETE);
        assert!(f.store.auto_complete_all(at(2)).unwrap());

        f.replace_description(id, OPEN);
        assert!(!f.store.auto_complete_all(at(3)).unwrap());
        assert_eq!(
            f.store.card(&f.project, id).unwrap().card_status,
            Column::Done
        );
    }
}
