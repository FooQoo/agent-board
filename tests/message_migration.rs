//! The one-time conversion of the old `qa/<request-id>/request.json` files, with fixtures in
//! the shape the earlier version wrote.

use std::fs;
use std::path::{Path, PathBuf};

use agent_board::domain::{Actor, Assignee, Column, Draft, NewTask, ProjectId, RunState};
use agent_board::file_store::FileStore;
use chrono::Utc;

const FIXTURES: [(&str, &str); 5] = [
    (
        "3f2a9c1e7b4d4c0e8a5f6b7c8d9e0a1b",
        include_str!("fixtures/qa_legacy/plan-open-and-answered.json"),
    ),
    (
        "7d1e0b2c9a8f4e3d8c7b6a5f4e3d2c1b",
        include_str!("fixtures/qa_legacy/task-open.json"),
    ),
    (
        "a0b1c2d3e4f5460718293a4b5c6d7e8f",
        include_str!("fixtures/qa_legacy/start-approval-open.json"),
    ),
    (
        "b1c2d3e4f5061728394a5b6c7d8e9f0a",
        include_str!("fixtures/qa_legacy/withdrawn.json"),
    ),
    (
        "c2d3e4f506172839405a6b7c8d9e0f1b",
        include_str!("fixtures/qa_legacy/answered.json"),
    ),
];

struct Board {
    _root: tempfile::TempDir,
    shared: PathBuf,
    store: FileStore,
    project: ProjectId,
}

impl Board {
    fn project_dir(&self) -> PathBuf {
        self.shared.join("projects").join(self.project.as_str())
    }

    fn qa(&self) -> PathBuf {
        self.project_dir().join("qa")
    }

    fn task(&self, title: &str, assignee: Assignee, doing: bool) -> i64 {
        let id = self
            .store
            .create_task(
                &self.project,
                NewTask {
                    title: title.into(),
                    description: String::new(),
                    assignee,
                    actor: Actor::Human,
                    draft: None,
                },
                Utc::now(),
            )
            .unwrap()
            .id;
        if doing {
            let ctx = agent_board::domain::ChangeContext {
                actor: Actor::Human,
                reason: "Start".into(),
            };
            self.store
                .move_work_task(&self.project, id, Column::Doing, ctx, Utc::now())
                .unwrap();
        }
        id
    }

    /// Point a task at the old questions, as its TASK.md did.
    fn refer(&self, task: i64, ids: &[&str]) {
        let path = self.project_dir().join(format!("tasks/{task}/TASK.md"));
        fs::write(
            path,
            format!(
                "---\nhistory: []\nquestions: [{}]\n---\nBody of #{task}\n",
                ids.join(", ")
            ),
        )
        .unwrap();
    }

    fn legacy(&self, fixtures: &[usize]) {
        for index in fixtures {
            let (id, text) = FIXTURES[*index];
            let dir = self.qa().join(id);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("request.json"), text).unwrap();
        }
        let path = self.project_dir().join("project.json");
        let mut project: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        project["nextQuestionId"] = 7.into();
        fs::write(path, serde_json::to_vec_pretty(&project).unwrap()).unwrap();
    }

    fn folders(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(self.qa())
            .map(|entries| {
                entries
                    .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    fn questions_of(&self, task: i64) -> String {
        fs::read_to_string(self.project_dir().join(format!("tasks/{task}/TASK.md"))).unwrap()
    }
}

fn board() -> Board {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Migrate", Utc::now()).unwrap().id;
    Board {
        _root: root,
        shared,
        store,
        project,
    }
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

#[test]
fn only_unanswered_questions_move_to_the_new_files() {
    let b = board();
    let waits = b.task("Import the data", Assignee::Ai, true);
    let both = b.task("Report the import", Assignee::Ai, true);
    b.legacy(&[0, 1, 3, 4]);
    b.refer(waits, &["Q-1", "Q-2"]);
    b.refer(both, &["Q-3", "Q-5", "Q-6"]);

    // Reading the project converts it.
    let snapshot = b.store.board(&b.project).unwrap();
    assert!(snapshot.problems.is_empty(), "{:?}", snapshot.problems);
    assert_eq!(b.folders(), vec!["Q-1", "Q-3"]);

    let q1 = read(&b.qa().join("Q-1/QA.md"));
    assert!(q1.starts_with("---\nfrom: ai\nto: human\n"), "{q1}");
    assert!(q1.contains(&format!("tasks:\n- {waits}\n")), "{q1}");
    assert!(q1.contains("recommended: keep"), "{q1}");
    assert!(
        q1.contains("reply: null") && q1.contains("withdrawnAt: null"),
        "{q1}"
    );
    assert!(q1.contains("createdAt: 2026-11-10T09:15:00Z"), "{q1}");
    assert!(
        q1.ends_with("Should existing records be deleted or kept?\n\nThe import runs once.\n"),
        "{q1}"
    );
    let q3 = read(&b.qa().join("Q-3/QA.md"));
    assert!(q3.contains(&format!("tasks:\n- {both}\n")), "{q3}");
    assert!(q3.contains("createdAt: 2026-11-11T13:00:00Z"), "{q3}");

    // The answered and the withdrawn questions are gone from the tasks, and they do not wait.
    assert!(b.questions_of(waits).contains("questions:\n- Q-1\n"));
    assert!(!b.questions_of(waits).contains("Q-2"));
    assert!(b.questions_of(both).contains("questions:\n- Q-3\n"));
    let waits_view = b.store.task(&b.project, waits).unwrap();
    assert_eq!(waits_view.agent_status, RunState::Pending);
    assert_eq!(waits_view.open_question_ids, vec!["Q-1"]);

    // The numbers go on from the old counter, and the converted question can be answered.
    let next = b.store.questions(&b.project).unwrap();
    assert_eq!(next.len(), 2);
    b.store
        .answer_questions(
            &b.project,
            vec![agent_board::file_store::AnswerItem {
                question_id: "Q-1".into(),
                choice_id: Some("keep".into()),
                text: None,
            }],
            agent_board::file_store::qa::AnswerVia::Cli,
            Utc::now(),
        )
        .unwrap();
}

#[test]
fn a_task_that_only_referred_to_dropped_questions_is_not_pending() {
    let b = board();
    let id = b.task("Log the progress", Assignee::Ai, true);
    b.legacy(&[3, 4]);
    b.refer(id, &["Q-5", "Q-6"]);
    let view = b.store.task(&b.project, id).unwrap();
    // The read of the task alone does not convert; the project read does, and then the task
    // no longer waits for a question that no longer exists.
    b.store.board(&b.project).unwrap();
    let view_after = b.store.task(&b.project, id).unwrap();
    assert_ne!(view_after.agent_status, RunState::Pending, "{view:?}");
    assert!(view_after.question_ids.is_empty());
    assert!(b.folders().is_empty());
}

#[test]
fn an_unanswered_start_approval_makes_its_ai_tasks_ai_drafts() {
    let b = board();
    let importer = b.task("Write the importer", Assignee::Ai, false);
    let docs = b.task("Document the importer", Assignee::Ai, false);
    let person = b.task("Review the plan", Assignee::Human, false);
    let started = b.task("Already working", Assignee::Ai, true);
    b.legacy(&[2]);
    for id in [importer, docs, person, started] {
        b.refer(id, &["Q-4"]);
    }

    b.store.board(&b.project).unwrap();

    // No question file is made for it.
    assert!(b.folders().is_empty());
    for id in [importer, docs] {
        let task = b.store.task(&b.project, id).unwrap();
        assert_eq!(task.draft, Some(Draft::Ai), "#{id}");
        assert!(task.question_ids.is_empty());
        assert_ne!(task.agent_status, RunState::Pending);
        assert!(
            task.history.last().unwrap().reason.contains("AI draft"),
            "{:?}",
            task.history.last()
        );
    }
    // A person's task and a task already in Doing are not drafts, and none of them waits.
    for id in [person, started] {
        let task = b.store.task(&b.project, id).unwrap();
        assert_eq!(task.draft, None, "#{id}");
        assert!(task.question_ids.is_empty());
        assert_ne!(task.agent_status, RunState::Pending);
    }
    // A person starts the drafts as before.
    let result = b
        .store
        .start_task(&b.project, importer, Actor::Human, Utc::now())
        .unwrap();
    assert!(result.changed);
}

#[test]
fn the_conversion_runs_once_and_a_write_triggers_it_too() {
    let b = board();
    let id = b.task("Import the data", Assignee::Ai, true);
    b.legacy(&[0, 1]);
    b.refer(id, &["Q-1"]);

    // The first thing done to the project is a write: asking a new question.
    let asked = b
        .store
        .ask_questions(
            &b.project,
            agent_board::file_store::AskInput {
                actor: Actor::Ai,
                asked_by: None,
                questions: vec![agent_board::file_store::AskQuestion {
                    body: "One more?".into(),
                    choices: Vec::new(),
                    recommended_choice_id: None,
                    tasks: vec![],
                    images: Vec::new(),
                }],
                tasks: vec![id],
            },
            Utc::now(),
        )
        .unwrap();
    assert_eq!(asked[0].id, "Q-7");
    assert_eq!(b.folders(), vec!["Q-1", "Q-3", "Q-7"]);
    assert!(fs::read_dir(b.qa()).unwrap().all(|e| {
        !e.unwrap()
            .file_name()
            .to_string_lossy()
            .chars()
            .all(|c| c.is_ascii_hexdigit())
    }));

    // Nothing is converted a second time.
    let before = read(&b.qa().join("Q-1/QA.md"));
    b.store.board(&b.project).unwrap();
    assert_eq!(read(&b.qa().join("Q-1/QA.md")), before);
    assert_eq!(b.folders(), vec!["Q-1", "Q-3", "Q-7"]);
}

#[test]
fn an_interrupted_conversion_finishes_without_a_second_copy() {
    let b = board();
    let id = b.task("Import the data", Assignee::Ai, true);
    b.legacy(&[0]);
    b.refer(id, &["Q-1"]);
    b.store.board(&b.project).unwrap();
    let converted = read(&b.qa().join("Q-1/QA.md"));

    // The old folder is back, as if the removal had not happened.
    b.legacy(&[0]);
    b.store.board(&b.project).unwrap();
    assert_eq!(b.folders(), vec!["Q-1"]);
    assert_eq!(read(&b.qa().join("Q-1/QA.md")), converted);
}

#[test]
fn an_unreadable_old_folder_is_kept_aside() {
    let b = board();
    let dir = b.qa().join("deadbeefdeadbeefdeadbeefdeadbeef");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("request.json"), "{ not json").unwrap();
    b.store.board(&b.project).unwrap();
    assert!(b.folders().is_empty());
    assert!(
        b.project_dir()
            .join(".internal/legacy-qa/deadbeefdeadbeefdeadbeefdeadbeef/request.json")
            .is_file()
    );
}
