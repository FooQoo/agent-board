use std::fs;
use std::path::Path;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId, RunState};
use agent_board::error::AgboardError;
use agent_board::file_store::Answer;
use agent_board::file_store::FileStore;
use agent_board::file_store::model::Choice;
use chrono::{TimeZone, Utc};

struct Fixture {
    _root: tempfile::TempDir,
    shared: std::path::PathBuf,
    store: FileStore,
    project: ProjectId,
}

fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let at = Utc.with_ymd_and_hms(2026, 10, 14, 0, 0, 0).unwrap();
    let project = store.create_project("History", at).unwrap().id;
    Fixture {
        _root: root,
        shared,
        store,
        project,
    }
}

fn file_tree(root: &Path) -> Vec<(std::path::PathBuf, Vec<u8>)> {
    fn visit(root: &Path, dir: &Path, files: &mut Vec<(std::path::PathBuf, Vec<u8>)>) {
        let mut entries: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        entries.sort();
        for path in entries {
            if path.is_dir() {
                visit(root, &path, files);
            } else {
                files.push((
                    path.strip_prefix(root).unwrap().to_owned(),
                    fs::read(path).unwrap(),
                ));
            }
        }
    }

    let mut files = Vec::new();
    visit(root, root, &mut files);
    files
}

impl Fixture {
    fn task_dir(&self, id: i64) -> std::path::PathBuf {
        self.shared
            .join("projects")
            .join(self.project.as_str())
            .join("tasks")
            .join(id.to_string())
    }

    fn create(&self, description: &str) -> i64 {
        self.store
            .create_task(
                &self.project,
                NewTask {
                    title: "Task".into(),
                    description: description.into(),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                    is_draft: false,
                },
                Utc.with_ymd_and_hms(2026, 10, 14, 0, 0, 0).unwrap(),
            )
            .unwrap()
            .id
    }
}

#[test]
fn task_json_is_metadata_only_and_task_md_is_the_history_source() {
    let fx = fixture();
    let id = fx.create("---\nacceptance: []\n---\n\nBody");
    let json: serde_json::Value =
        serde_json::from_slice(&fs::read(fx.task_dir(id).join("task.json")).unwrap()).unwrap();
    let markdown = fs::read_to_string(fx.task_dir(id).join("TASK.md")).unwrap();

    assert_eq!(json["formatVersion"], 1);
    assert!(json.get("history").is_none());
    assert!(markdown.contains("history:"));
    assert_eq!(fx.store.task(&fx.project, id).unwrap().history.len(), 1);
}

#[test]
fn task_format_versions_other_than_one_are_reported_and_left_byte_for_byte_unchanged() {
    let fx = fixture();
    let id = fx.create("");
    let json_path = fx.task_dir(id).join("task.json");
    let mut json: serde_json::Value =
        serde_json::from_slice(&fs::read(&json_path).unwrap()).unwrap();
    for version in [0, 2, 3] {
        json["formatVersion"] = version.into();
        let bytes = serde_json::to_vec_pretty(&json).unwrap();
        fs::write(&json_path, &bytes).unwrap();
        let files_before = file_tree(&fx.task_dir(id));

        let snapshot = fx.store.board(&fx.project).unwrap();
        assert!(snapshot.tasks.is_empty());
        assert!(snapshot.problems.iter().any(|problem| {
            problem.file.ends_with("task.json")
                && problem.field == "formatVersion"
                && problem.reason.contains("Only formatVersion 1")
        }));
        assert!(matches!(
            fx.store.task(&fx.project, id),
            Err(AgboardError::FormatUnsupported { .. })
        ));
        assert_eq!(fs::read(&json_path).unwrap(), bytes);
        assert_eq!(file_tree(&fx.task_dir(id)), files_before);
    }
}

#[test]
fn malformed_history_keeps_body_and_acceptance_but_blocks_updates() {
    let fx = fixture();
    let id = fx.create(
        "---\nacceptance:\n  - id: AC-1\n    text: Keep\n    done: false\n---\n\nVisible body",
    );
    let path = fx.task_dir(id).join("TASK.md");
    fs::write(
        &path,
        "---\nacceptance:\n  - id: AC-1\n    text: Keep\n    done: false\nhistory: null\n---\n\nVisible body",
    )
    .unwrap();

    let snapshot = fx.store.board(&fx.project).unwrap();
    assert_eq!(snapshot.tasks[0].body, "Visible body");
    assert_eq!(snapshot.tasks[0].acceptance.len(), 1);
    assert!(!snapshot.tasks[0].acceptance_error);
    assert!(
        snapshot
            .problems
            .iter()
            .any(|problem| { problem.file.ends_with("TASK.md") && problem.field == "history" })
    );
    let before_json = fs::read(fx.task_dir(id).join("task.json")).unwrap();
    assert!(matches!(
        fx.store.set_draft(&fx.project, id, true, Utc::now()),
        Err(AgboardError::FileInvalid { field, .. }) if field == "history"
    ));
    assert_eq!(
        fs::read(fx.task_dir(id).join("task.json")).unwrap(),
        before_json
    );
}

#[test]
fn state_history_and_pending_request_survive_reopen_and_noops_add_nothing() {
    let fx = fixture();
    let id = fx.create("");
    let moved = fx
        .store
        .move_work_task(
            &fx.project,
            id,
            Column::Doing,
            ChangeContext {
                actor: Actor::Ai,
                reason: "Start".into(),
            },
            Utc.with_ymd_and_hms(2026, 10, 14, 0, 1, 0).unwrap(),
        )
        .unwrap();
    assert!(moved.changed);
    let asked = fx
        .store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "Continue?",
            vec![],
            Utc.with_ymd_and_hms(2026, 10, 14, 0, 2, 0).unwrap(),
        )
        .unwrap();
    assert!(asked.changed);
    let before = fs::read(fx.task_dir(id).join("TASK.md")).unwrap();
    let repeated = fx
        .store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "A different question",
            vec![Choice {
                id: "choice".into(),
                label: "Choice".into(),
            }],
            Utc.with_ymd_and_hms(2026, 10, 14, 0, 3, 0).unwrap(),
        )
        .unwrap();
    assert!(!repeated.changed);
    assert_eq!(fs::read(fx.task_dir(id).join("TASK.md")).unwrap(), before);

    let reopened = FileStore::open(&fx.shared);
    let pending = reopened.task(&fx.project, id).unwrap();
    assert_eq!(pending.agent_status, RunState::Pending);
    assert_eq!(pending.pending_reason.as_deref(), Some("Continue?"));
    assert!(pending.pending_choices.is_empty());
    let request_id = pending.pending_request_id.unwrap();
    let answered = reopened
        .answer_request(
            &fx.project,
            id,
            &request_id,
            Answer {
                actor: Actor::Human,
                choice_id: None,
                text: Some("Proceed".into()),
            },
            Utc.with_ymd_and_hms(2026, 10, 14, 0, 4, 0).unwrap(),
        )
        .unwrap();
    assert_eq!(answered.agent_status, RunState::Idle);
    let json: serde_json::Value =
        serde_json::from_slice(&fs::read(fx.task_dir(id).join("task.json")).unwrap()).unwrap();
    assert!(json.get("history").is_none());
    let history = agent_board::file_store::history::parse_task(
        &fs::read_to_string(fx.task_dir(id).join("TASK.md")).unwrap(),
        agent_board::file_store::history::ParseMode::Stored,
    );
    assert_eq!(history.history.len(), 4);
    assert_eq!(history.history[1].reason, "Start");
    assert!(history.history[2].reason.contains("Continue?"));
    assert!(history.history[3].reason.contains("Proceed"));
    assert_eq!(json["requestAnswers"][0]["text"], "Proceed");
}
