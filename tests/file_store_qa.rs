//! Project questions in the shared files: asking several at once, answering, withdrawing,
//! linking, and how a task's waiting is derived from the questions it refers to.

#[path = "support/qa.rs"]
mod qa;

use std::fs;
use std::path::PathBuf;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId, RunState};
use agent_board::error::AgboardError;
use agent_board::file_store::qa::{AnswerVia, QuestionKind, QuestionStatus};
use agent_board::file_store::{AnswerItem, AskInput, AskQuestion, FileStore};
use chrono::Utc;

struct Fixture {
    _root: tempfile::TempDir,
    shared: PathBuf,
    store: FileStore,
    project: ProjectId,
}

fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Questions", Utc::now()).unwrap().id;
    Fixture {
        _root: root,
        shared,
        store,
        project,
    }
}

impl Fixture {
    fn project_dir(&self) -> PathBuf {
        self.shared.join("projects").join(self.project.as_str())
    }

    fn task(&self, title: &str) -> i64 {
        self.store
            .create_task(
                &self.project,
                NewTask {
                    title: title.into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                    is_draft: false,
                },
                Utc::now(),
            )
            .unwrap()
            .id
    }

    fn doing(&self, id: i64) {
        self.store
            .move_work_task(&self.project, id, Column::Doing, ctx("Start"), Utc::now())
            .unwrap();
    }

    fn question(&self, text: &str, tasks: Vec<i64>) -> AskQuestion {
        AskQuestion {
            kind: QuestionKind::Task,
            question: text.into(),
            choices: qa::choices(&[("a", "Plan A"), ("b", "Plan B")]),
            recommended_choice_id: Some("a".into()),
            approving_choice_ids: Vec::new(),
            tasks,
        }
    }

    fn ask(&self, questions: Vec<AskQuestion>, tasks: Vec<i64>) -> Result<String, AgboardError> {
        self.store
            .ask_questions(
                &self.project,
                AskInput {
                    actor: Actor::Ai,
                    questions,
                    tasks,
                },
                Utc::now(),
            )
            .map(|request| request.request_id)
    }

    fn answer(&self, id: &str, choice: Option<&str>) -> Result<(), AgboardError> {
        self.store
            .answer_questions(
                &self.project,
                vec![AnswerItem {
                    question_id: id.into(),
                    choice_id: choice.map(str::to_string),
                    text: None,
                }],
                AnswerVia::Chat,
                Utc::now(),
            )
            .map(|_| ())
    }

    fn files(&self) -> Vec<(PathBuf, Vec<u8>)> {
        let mut out = Vec::new();
        let mut stack = vec![self.project_dir()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    out.push((path.clone(), fs::read(&path).unwrap()));
                }
            }
        }
        out.sort();
        out
    }
}

fn ctx(reason: &str) -> ChangeContext {
    ChangeContext {
        actor: Actor::Ai,
        reason: reason.into(),
    }
}

#[test]
fn one_request_holds_several_questions_with_their_own_numbers_and_tasks() {
    let fx = fixture();
    let first = fx.task("first");
    let second = fx.task("second");
    fx.doing(first);
    fx.store
        .set_agent_status(
            &fx.project,
            first,
            RunState::Running,
            ctx("Work"),
            Utc::now(),
        )
        .unwrap();
    let request = fx
        .ask(
            vec![
                fx.question("Shared question?", Vec::new()),
                fx.question("Only for the second?", vec![second]),
            ],
            vec![first],
        )
        .unwrap();

    let file = fx
        .project_dir()
        .join("qa")
        .join(&request)
        .join("request.json");
    let saved: serde_json::Value = serde_json::from_slice(&fs::read(file).unwrap()).unwrap();
    assert_eq!(saved["formatVersion"], 1);
    assert_eq!(saved["requestId"], request.as_str());
    assert_eq!(saved["questions"][0]["id"], "Q-1");
    assert_eq!(saved["questions"][1]["id"], "Q-2");
    assert!(saved["questions"][0]["answer"].is_null());
    let project: serde_json::Value =
        serde_json::from_slice(&fs::read(fx.project_dir().join("project.json")).unwrap()).unwrap();
    assert_eq!(project["nextQuestionId"], 3);

    let first_view = fx.store.task(&fx.project, first).unwrap();
    assert_eq!(first_view.question_ids, vec!["Q-1", "Q-2"]);
    // A running task that asks becomes idle and waits.
    assert_eq!(first_view.agent_status, RunState::Pending);
    let second_view = fx.store.task(&fx.project, second).unwrap();
    assert_eq!(second_view.question_ids, vec!["Q-2"]);
    let markdown = fs::read_to_string(
        fx.project_dir()
            .join("tasks")
            .join(second.to_string())
            .join("TASK.md"),
    )
    .unwrap();
    assert!(markdown.contains("questions:"), "{markdown}");
    assert!(markdown.contains("Q-2"), "{markdown}");
    let stored: serde_json::Value = serde_json::from_slice(
        &fs::read(
            fx.project_dir()
                .join("tasks")
                .join(first.to_string())
                .join("task.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(stored["agentStatus"], "idle");

    // Answering one question keeps the first task waiting on the other.
    fx.answer("Q-1", Some("a")).unwrap();
    assert_eq!(
        fx.store.task(&fx.project, first).unwrap().agent_status,
        RunState::Pending
    );
    fx.answer("Q-2", Some("b")).unwrap();
    assert_eq!(
        fx.store.task(&fx.project, first).unwrap().agent_status,
        RunState::Idle
    );
    let (file, views) = fx.store.request(&fx.project, &request).unwrap();
    assert_eq!(views.len(), 2);
    assert!(views.iter().all(|q| q.status == QuestionStatus::Answered));
    assert_eq!(
        file.questions[1]
            .answer
            .as_ref()
            .unwrap()
            .choice_label
            .as_deref(),
        Some("Plan B")
    );
}

#[test]
fn a_refused_request_writes_nothing_and_reserves_no_number() {
    let fx = fixture();
    let open = fx.task("open");
    let archived = fx.task("archived");
    fx.store
        .archive_task(&fx.project, archived, Utc::now())
        .unwrap();
    let before = fx.files();
    for tasks in [vec![archived], vec![99]] {
        let err = fx
            .ask(vec![fx.question("Which?", Vec::new())], tasks)
            .unwrap_err();
        assert!(
            matches!(
                err,
                AgboardError::TaskNotFound { .. } | AgboardError::TaskArchived { .. }
            ),
            "{err:?}"
        );
        assert_eq!(fx.files(), before);
    }
    let mut bad = fx.question("One choice", Vec::new());
    bad.choices.truncate(1);
    assert!(fx.ask(vec![bad], vec![open]).is_err());
    assert_eq!(fx.files(), before);
    assert!(fx.ask(Vec::new(), vec![open]).is_err());
    assert_eq!(fx.files(), before);

    fx.ask(vec![fx.question("Now?", Vec::new())], vec![open])
        .unwrap();
    assert_eq!(
        fx.store.questions(&fx.project).unwrap()[0].id,
        "Q-1",
        "a refused request must not use a number"
    );
}

#[test]
fn the_first_answer_is_kept_and_a_conflicting_batch_writes_nothing() {
    let fx = fixture();
    let id = fx.task("work");
    fx.ask(
        vec![
            fx.question("First?", Vec::new()),
            fx.question("Second?", Vec::new()),
        ],
        vec![id],
    )
    .unwrap();
    fx.answer("Q-1", Some("a")).unwrap();
    let err = fx
        .store
        .answer_questions(
            &fx.project,
            vec![
                AnswerItem {
                    question_id: "Q-1".into(),
                    choice_id: Some("b".into()),
                    text: None,
                },
                AnswerItem {
                    question_id: "Q-2".into(),
                    choice_id: None,
                    text: Some("Go ahead".into()),
                },
            ],
            AnswerVia::Ui,
            Utc::now(),
        )
        .unwrap_err();
    assert!(
        matches!(&err, AgboardError::QuestionAnswered { ids } if ids == &vec!["Q-1".to_string()]),
        "{err:?}"
    );
    let first = fx.store.question(&fx.project, "Q-1").unwrap();
    assert_eq!(first.answer.unwrap().choice_id.as_deref(), Some("a"));
    // All or nothing: the other answer of the batch was not written either.
    let second = fx.store.question(&fx.project, "Q-2").unwrap();
    assert!(second.answer.is_none());
    assert_eq!(second.status, QuestionStatus::Open);

    assert!(matches!(
        fx.answer("Q-9", Some("a")),
        Err(AgboardError::QuestionNotFound { .. })
    ));
    assert!(matches!(
        fx.store.question(&fx.project, "Q-9"),
        Err(AgboardError::QuestionNotFound { .. })
    ));
}

#[test]
fn withdrawing_ends_the_wait_is_repeatable_and_refuses_an_answered_request() {
    let fx = fixture();
    let id = fx.task("work");
    let request = fx
        .ask(vec![fx.question("Still needed?", Vec::new())], vec![id])
        .unwrap();
    let withdrawn = fx
        .store
        .withdraw_request(
            &fx.project,
            &request,
            Actor::Ai,
            Some("Not needed"),
            Utc::now(),
        )
        .unwrap();
    assert!(withdrawn.withdrawn_at.is_some());
    assert_eq!(withdrawn.withdraw_reason.as_deref(), Some("Not needed"));
    let task = fx.store.task(&fx.project, id).unwrap();
    assert_eq!(task.agent_status, RunState::Idle);
    assert!(
        task.history
            .last()
            .unwrap()
            .reason
            .contains("Withdrew a question (Q-1)")
    );
    let again = fx
        .store
        .withdraw_request(&fx.project, &request, Actor::Ai, None, Utc::now())
        .unwrap();
    assert_eq!(again.withdrawn_at, withdrawn.withdrawn_at);
    assert!(matches!(
        fx.answer("Q-1", Some("a")),
        Err(AgboardError::QuestionWithdrawn { .. })
    ));

    let answered = fx
        .ask(vec![fx.question("Answer me", Vec::new())], vec![id])
        .unwrap();
    fx.answer("Q-2", Some("a")).unwrap();
    assert!(matches!(
        fx.store
            .withdraw_request(&fx.project, &answered, Actor::Ai, None, Utc::now()),
        Err(AgboardError::RequestAnswered { .. })
    ));
    assert!(matches!(
        fx.store
            .withdraw_request(&fx.project, &"0".repeat(32), Actor::Ai, None, Utc::now()),
        Err(AgboardError::RequestNotFound { .. })
    ));
}

#[test]
fn a_rejected_start_approval_keeps_the_task_waiting_until_it_is_unlinked() {
    let fx = fixture();
    let id = fx.task("work");
    qa::ask_kind(
        &fx.store,
        &fx.project,
        &[id],
        QuestionKind::StartApproval,
        "May I start?",
        &[("go", "Start"), ("stop", "Not yet")],
        &["go"],
    );
    fx.answer("Q-1", Some("stop")).unwrap();
    assert_eq!(
        fx.store.task(&fx.project, id).unwrap().agent_status,
        RunState::Pending
    );
    let unlinked = fx
        .store
        .link_questions(
            &fx.project,
            id,
            &["Q-1".into()],
            false,
            Actor::Ai,
            Utc::now(),
        )
        .unwrap();
    assert!(unlinked.question_ids.is_empty());
    assert_eq!(unlinked.agent_status, RunState::Idle);
    let linked = fx
        .store
        .link_questions(
            &fx.project,
            id,
            &["Q-1".into()],
            true,
            Actor::Ai,
            Utc::now(),
        )
        .unwrap();
    assert_eq!(linked.question_ids, vec!["Q-1"]);
    assert_eq!(linked.agent_status, RunState::Pending);
    assert!(
        linked
            .history
            .last()
            .unwrap()
            .reason
            .contains("Added question Q-1 to the references.")
    );
    assert!(matches!(
        fx.store.link_questions(
            &fx.project,
            id,
            &["Q-7".into()],
            true,
            Actor::Ai,
            Utc::now()
        ),
        Err(AgboardError::QuestionNotFound { .. })
    ));
}

#[test]
fn a_broken_request_file_or_reference_list_makes_the_task_wait() {
    let fx = fixture();
    let id = fx.task("work");
    let request = fx
        .ask(vec![fx.question("Broken later?", Vec::new())], vec![id])
        .unwrap();
    fx.answer("Q-1", Some("a")).unwrap();
    assert_eq!(
        fx.store.task(&fx.project, id).unwrap().agent_status,
        RunState::Idle
    );
    let file = fx
        .project_dir()
        .join("qa")
        .join(&request)
        .join("request.json");
    let saved = fs::read(&file).unwrap();
    fs::write(&file, b"{ not json").unwrap();
    assert_eq!(
        fx.store.task(&fx.project, id).unwrap().agent_status,
        RunState::Pending
    );
    assert!(matches!(
        fx.store.question(&fx.project, "Q-1"),
        Err(AgboardError::FileInvalid { .. })
    ));
    fs::write(&file, saved).unwrap();

    let markdown = fx
        .project_dir()
        .join("tasks")
        .join(id.to_string())
        .join("TASK.md");
    let text = fs::read_to_string(&markdown).unwrap();
    fs::write(&markdown, text.replace("- Q-1", "- nope")).unwrap();
    let broken = fx.store.task(&fx.project, id).unwrap();
    assert!(broken.questions_error);
    assert_eq!(broken.agent_status, RunState::Pending);
}

/// A plan task: answered plan questions do not release it; only an approval that was given does.
fn plan_fixture() -> (Fixture, i64, String) {
    let fx = fixture();
    let id = fx.task("planned work");
    fx.doing(id);
    let request = qa::ask_kind(
        &fx.store,
        &fx.project,
        &[id],
        QuestionKind::Plan,
        "Which size?",
        &[("s", "Small"), ("l", "Large")],
        &[],
    );
    (fx, id, request.request_id)
}

fn status(fx: &Fixture, id: i64) -> RunState {
    fx.store.task(&fx.project, id).unwrap().agent_status
}

fn ask_approval(fx: &Fixture, id: i64) {
    qa::ask_kind(
        &fx.store,
        &fx.project,
        &[id],
        QuestionKind::StartApproval,
        "Start this plan?",
        &[("go", "Start"), ("revise", "Change the plan")],
        &["go"],
    );
}

#[test]
fn an_answered_plan_question_keeps_the_task_waiting_until_an_approval_is_given() {
    let (fx, id, _) = plan_fixture();
    assert_eq!(status(&fx, id), RunState::Pending);
    fx.answer("Q-1", Some("s")).unwrap();
    let task = fx.store.task(&fx.project, id).unwrap();
    assert_eq!(task.agent_status, RunState::Pending);
    assert!(task.open_question_ids.is_empty());
    let err = fx
        .store
        .set_agent_status(&fx.project, id, RunState::Running, ctx("Start"), Utc::now())
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::QuestionsUnanswered { .. }),
        "{err:?}"
    );

    ask_approval(&fx, id);
    assert_eq!(status(&fx, id), RunState::Pending);
    fx.answer("Q-2", Some("go")).unwrap();
    assert_eq!(status(&fx, id), RunState::Idle);
    fx.store
        .set_agent_status(&fx.project, id, RunState::Running, ctx("Start"), Utc::now())
        .unwrap();
}

#[test]
fn a_refused_approval_keeps_a_plan_task_waiting() {
    let (fx, id, _) = plan_fixture();
    fx.answer("Q-1", Some("l")).unwrap();
    ask_approval(&fx, id);
    fx.answer("Q-2", Some("revise")).unwrap();
    assert_eq!(status(&fx, id), RunState::Pending);
}

#[test]
fn a_withdrawn_plan_question_does_not_hold_the_task() {
    let (fx, id, request_id) = plan_fixture();
    assert_eq!(status(&fx, id), RunState::Pending);
    fx.store
        .withdraw_request(&fx.project, &request_id, Actor::Ai, None, Utc::now())
        .unwrap();
    assert_eq!(status(&fx, id), RunState::Idle);
}
