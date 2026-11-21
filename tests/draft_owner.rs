//! The edit lock: `draft` is none or `human`. A person's draft is read-only for agents.
//! Every test uses a temporary data area; servers listen on port 0.

mod common;

use agent_board::domain::{Actor, Assignee, Draft, NewTask, ProjectId};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::file_store::model::NewEpic;
use agent_board::file_store::validate::EpicId;
use chrono::{TimeZone, Utc};
use serde_json::{Value, json};
use std::fs;

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 17, 0, 0, 0).unwrap()
}

struct Fx {
    _root: tempfile::TempDir,
    store: FileStore,
    project: ProjectId,
    project_dir: std::path::PathBuf,
}

fn fx() -> Fx {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Alpha", now()).unwrap().id;
    let project_dir = shared.join("projects").join(project.as_str());
    Fx {
        _root: root,
        store,
        project,
        project_dir,
    }
}

impl Fx {
    fn task(&self, actor: Actor, assignee: Assignee, draft: Option<Draft>) -> i64 {
        self.store
            .create_task(
                &self.project,
                NewTask {
                    title: "Work".into(),
                    description: String::new(),
                    assignee,
                    actor,
                    draft,
                },
                now(),
            )
            .unwrap()
            .id
    }

    fn epic(&self, id: &str, draft: Option<Draft>) -> EpicId {
        let epic = self
            .store
            .create_epic(
                &self.project,
                NewEpic {
                    id: id.into(),
                    name: "Epic".into(),
                    color: None,
                    draft,
                    document: None,
                },
                now(),
            )
            .unwrap();
        epic.id
    }

    fn draft_of(&self, id: i64) -> Option<Draft> {
        self.store.task(&self.project, id).unwrap().draft
    }
}

#[test]
fn stored_is_draft_reads_as_draft_and_the_new_field_is_written() {
    let f = fx();
    let on = f.task(Actor::Human, Assignee::Ai, None);
    let off = f.task(Actor::Human, Assignee::Ai, None);
    let path = |id: i64| f.project_dir.join(format!("tasks/{id}/task.json"));
    let set = |id: i64, value: Value| {
        let mut meta: Value = serde_json::from_str(&fs::read_to_string(path(id)).unwrap()).unwrap();
        meta.as_object_mut().unwrap().remove("draft");
        meta["isDraft"] = value;
        fs::write(path(id), serde_json::to_string_pretty(&meta).unwrap()).unwrap();
    };
    set(on, json!(true));
    set(off, json!(false));
    assert_eq!(f.draft_of(on), Some(Draft::Human));
    assert_eq!(f.draft_of(off), None);

    // Writing uses the new field only.
    f.store
        .set_draft(&f.project, off, Some(Draft::Human), false, now())
        .unwrap();
    let meta: Value = serde_json::from_str(&fs::read_to_string(path(off)).unwrap()).unwrap();
    assert_eq!(meta["draft"], "human");
    assert!(meta.get("isDraft").is_none());

    // The same holds for an epic.
    let epic = f.epic("OLD", None);
    let epic_json = f.project_dir.join("epics/OLD/epic.json");
    let mut stored: Value = serde_json::from_str(&fs::read_to_string(&epic_json).unwrap()).unwrap();
    stored.as_object_mut().unwrap().remove("draft");
    stored["isDraft"] = json!(true);
    fs::write(&epic_json, serde_json::to_string_pretty(&stored).unwrap()).unwrap();
    assert_eq!(
        f.store.epic(&f.project, &epic).unwrap().draft,
        Some(Draft::Human)
    );
}

#[test]
fn a_persons_draft_still_refuses_an_agent_edit() {
    let f = fx();
    let id = f.task(Actor::Human, Assignee::Ai, Some(Draft::Human));
    assert!(matches!(
        f.store.edit_task(&f.project, id, Some("x"), None, now()),
        Err(AgboardError::TaskIsDraft { .. })
    ));
    assert!(matches!(
        f.store.add_history(&f.project, id, Some("note"), now()),
        Err(AgboardError::TaskIsDraft { .. })
    ));
}
