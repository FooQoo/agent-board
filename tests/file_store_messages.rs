//! Messages in the shared files: one `qa/Q-<n>/QA.md` for each question and each request, the
//! rules of who writes a reply and when, and how a task's waiting follows its questions.

#[path = "support/qa.rs"]
mod qa;

use std::fs;
use std::path::PathBuf;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId, RunState};
use agent_board::error::AgboardError;
use agent_board::file_store::qa::{AnswerVia, MessageView, QuestionStatus, RequestStatus};
use agent_board::file_store::{
    Accepted, AnswerItem, AskInput, AskQuestion, FileStore, RequestImage, SendRequestInput,
};
use chrono::Utc;

/// A 1x1 PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0x60, 0xf8, 0x5f,
    0x0f, 0x00, 0x02, 0x87, 0x01, 0x80, 0xeb, 0x47, 0xba, 0x92, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

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
    let project = store.create_project("Messages", Utc::now()).unwrap().id;
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

    fn file(&self, id: &str) -> String {
        fs::read_to_string(self.project_dir().join(format!("qa/{id}/QA.md"))).unwrap()
    }

    fn task(&self, title: &str) -> i64 {
        let id = self
            .store
            .create_task(
                &self.project,
                NewTask {
                    title: title.into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Human,
                    draft: None,
                },
                Utc::now(),
            )
            .unwrap()
            .id;
        let ctx = ChangeContext {
            actor: Actor::Ai,
            reason: "Start".into(),
        };
        self.store
            .move_work_task(&self.project, id, Column::Doing, ctx, Utc::now())
            .unwrap();
        id
    }

    fn ask(&self, body: &str, choices: &[(&str, &str)], tasks: &[i64]) -> String {
        self.store
            .ask_questions(
                &self.project,
                AskInput {
                    actor: Actor::Ai,
                    asked_by: None,
                    questions: vec![AskQuestion {
                        body: body.into(),
                        choices: qa::choices(choices),
                        recommended_choice_id: None,
                        tasks: Vec::new(),
                    }],
                    tasks: tasks.to_vec(),
                },
                Utc::now(),
            )
            .unwrap()
            .remove(0)
            .id
    }

    fn answer(
        &self,
        id: &str,
        choice: Option<&str>,
        text: Option<&str>,
    ) -> Result<Vec<agent_board::file_store::qa::QuestionView>, AgboardError> {
        self.store.answer_questions(
            &self.project,
            vec![AnswerItem {
                question_id: id.into(),
                choice_id: choice.map(str::to_string),
                text: text.map(str::to_string),
            }],
            AnswerVia::Cli,
            Utc::now(),
        )
    }

    fn send(&self, text: &str) -> String {
        self.store
            .send_request(
                &self.project,
                SendRequestInput {
                    text: text.into(),
                    images: Vec::new(),
                },
                Utc::now(),
            )
            .unwrap()
            .id
    }

    fn withdraw(&self, id: &str, actor: Actor) -> Result<(), AgboardError> {
        self.store
            .withdraw_message(&self.project, id, actor, Utc::now())
            .map(|_| ())
    }
}

#[test]
fn every_message_is_one_file_and_one_sequence_numbers_them() {
    let f = fixture();
    let task = f.task("Import");
    let asked = f
        .store
        .ask_questions(
            &f.project,
            AskInput {
                actor: Actor::Ai,
                asked_by: None,
                questions: vec![
                    AskQuestion {
                        body: "Keep the records?".into(),
                        choices: qa::choices(&[("keep", "Keep"), ("drop", "Drop")]),
                        recommended_choice_id: Some("keep".into()),
                        tasks: Vec::new(),
                    },
                    AskQuestion {
                        body: "Anything else to know?".into(),
                        choices: Vec::new(),
                        recommended_choice_id: None,
                        tasks: Vec::new(),
                    },
                ],
                tasks: vec![task],
            },
            Utc::now(),
        )
        .unwrap();
    let ids: Vec<_> = asked.iter().map(|q| q.id.as_str()).collect();
    assert_eq!(ids, ["Q-1", "Q-2"]);
    assert_eq!(f.send("Add a reset link."), "Q-3");

    let qa_dir = f.project_dir().join("qa");
    let mut names: Vec<_> = fs::read_dir(&qa_dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["Q-1", "Q-2", "Q-3"]);
    for id in ["Q-1", "Q-2", "Q-3"] {
        let entries: Vec<_> = fs::read_dir(qa_dir.join(id))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries, ["QA.md"], "{id}");
    }

    let project: serde_json::Value =
        serde_json::from_slice(&fs::read(f.project_dir().join("project.json")).unwrap()).unwrap();
    assert_eq!(project["nextQuestionId"], 4);

    let q1 = f.file("Q-1");
    assert!(q1.starts_with("---\nfrom: ai\nto: human\n"), "{q1}");
    assert!(q1.contains(&format!("tasks:\n- {task}\n")), "{q1}");
    assert!(q1.contains("choices:\n- id: keep\n  label: Keep\n"), "{q1}");
    assert!(
        q1.contains("recommended: keep\nreply: null\nwithdrawnAt: null\n"),
        "{q1}"
    );
    assert!(q1.ends_with("---\n\nKeep the records?\n"), "{q1}");
    let q3 = f.file("Q-3");
    assert!(
        q3.starts_with("---\nfrom: human\nto: ai\nacceptedAt: null\nwithdrawnAt: null\n"),
        "{q3}"
    );
    assert!(q3.ends_with("---\n\nAdd a reset link.\n"), "{q3}");
    // The state is never stored.
    for text in [&q1, &q3] {
        assert!(
            !text.contains("status") && !text.contains("state"),
            "{text}"
        );
    }
    // The task refers to both questions, and neither request.json nor a kind exists.
    assert_eq!(
        f.store.task(&f.project, task).unwrap().question_ids,
        ["Q-1", "Q-2"]
    );
    assert!(!q1.contains("kind"));
}

#[test]
fn a_reply_needs_a_choice_or_a_note_when_the_question_has_choices() {
    let f = fixture();
    let with = f.ask("Keep?", &[("keep", "Keep"), ("drop", "Drop")], &[]);
    let without = f.ask("Why?", &[], &[]);
    let note_only = f.ask("Keep it?", &[("keep", "Keep"), ("drop", "Drop")], &[]);

    assert!(matches!(
        f.answer(&with, None, None),
        Err(AgboardError::InvalidValue { .. })
    ));
    assert!(matches!(
        f.answer(&with, None, Some("   ")),
        Err(AgboardError::InvalidValue { .. })
    ));
    assert!(matches!(
        f.answer(&with, Some("nope"), None),
        Err(AgboardError::ChoiceUnknown { .. })
    ));
    assert!(matches!(
        f.answer(&without, Some("keep"), None),
        Err(AgboardError::ChoiceUnknown { .. })
    ));
    assert!(matches!(
        f.answer(&without, None, None),
        Err(AgboardError::InvalidValue { .. })
    ));
    let long = "x".repeat(2001);
    assert!(matches!(
        f.answer(&without, None, Some(&long)),
        Err(AgboardError::InvalidValue { .. })
    ));
    // Nothing was written by the refusals.
    assert!(f.file(&with).contains("reply: null"));

    let views = f.answer(&with, Some("keep"), Some("Keep it.")).unwrap();
    assert_eq!(views[0].status, QuestionStatus::Answered);
    let reply = views[0].reply.as_ref().unwrap();
    assert_eq!(reply.choice_label.as_deref(), Some("Keep"));
    assert_eq!(reply.text.as_deref(), Some("Keep it."));
    assert!(
        f.file(&with)
            .contains("reply:\n  choice: keep\n  text: Keep it.\n  via: cli\n")
    );
    f.answer(&without, None, Some("Because.")).unwrap();
    assert!(!f.file(&without).contains("choice:"));

    // A note alone answers a question with choices; the reply has no choice.
    let views = f
        .answer(&note_only, None, Some("Neither; ask legal."))
        .unwrap();
    assert_eq!(views[0].status, QuestionStatus::Answered);
    let reply = views[0].reply.as_ref().unwrap();
    assert_eq!(reply.choice_id, None);
    assert_eq!(reply.choice_label, None);
    assert_eq!(reply.text.as_deref(), Some("Neither; ask legal."));
    assert!(!f.file(&note_only).contains("choice:\n") && !f.file(&note_only).contains("  choice:"));
}

#[test]
fn a_reply_is_written_once_and_nothing_is_written_after_a_withdrawal() {
    let f = fixture();
    let answered = f.ask("Keep?", &[("keep", "Keep"), ("drop", "Drop")], &[]);
    let withdrawn = f.ask("Drop?", &[("yes", "Yes"), ("no", "No")], &[]);
    f.answer(&answered, Some("keep"), None).unwrap();
    let written = f.file(&answered);

    let again = f.answer(&answered, Some("drop"), None).unwrap_err();
    assert!(
        matches!(&again, AgboardError::QuestionAnswered { ids } if ids == std::slice::from_ref(&answered))
    );
    assert_eq!(f.file(&answered), written);

    f.withdraw(&withdrawn, Actor::Ai).unwrap();
    let after = f.answer(&withdrawn, Some("yes"), None).unwrap_err();
    assert!(matches!(after, AgboardError::QuestionWithdrawn { .. }));
    assert!(f.file(&withdrawn).contains("reply: null"));
    // A reply that was given cannot be withdrawn away.
    assert!(matches!(
        f.withdraw(&answered, Actor::Ai),
        Err(AgboardError::MessageClosed { .. })
    ));
    // Answers are checked together: one bad item writes nothing.
    let open = f.ask("Ship?", &[("yes", "Yes"), ("no", "No")], &[]);
    let result = f.store.answer_questions(
        &f.project,
        vec![
            AnswerItem {
                question_id: open.clone(),
                choice_id: Some("yes".into()),
                text: None,
            },
            AnswerItem {
                question_id: answered.clone(),
                choice_id: Some("drop".into()),
                text: None,
            },
        ],
        AnswerVia::Ui,
        Utc::now(),
    );
    assert!(result.is_err());
    assert!(f.file(&open).contains("reply: null"));
}

#[test]
fn a_question_is_withdrawn_by_an_agent_and_a_request_by_a_person() {
    let f = fixture();
    let question = f.ask("Keep?", &[("keep", "Keep"), ("drop", "Drop")], &[]);
    let request = f.send("Add a link.");

    assert!(matches!(
        f.withdraw(&question, Actor::Human),
        Err(AgboardError::AiOnly { .. })
    ));
    assert!(matches!(
        f.withdraw(&request, Actor::Ai),
        Err(AgboardError::HumanOnly { .. })
    ));
    assert!(f.file(&question).contains("withdrawnAt: null"));

    let first = f
        .store
        .withdraw_message(&f.project, &question, Actor::Ai, Utc::now())
        .unwrap();
    assert!(first.changed);
    let again = f
        .store
        .withdraw_message(&f.project, &question, Actor::Ai, Utc::now())
        .unwrap();
    assert!(!again.changed);
    f.withdraw(&request, Actor::Human).unwrap();
    assert!(!f.file(&request).contains("withdrawnAt: null"));
    assert!(matches!(
        f.withdraw("Q-99", Actor::Ai),
        Err(AgboardError::MessageNotFound { .. })
    ));
}

#[test]
fn a_request_is_accepted_once_by_one_agent() {
    let f = fixture();
    let request = f.send("Add a reset link.");
    let question = f.ask("Keep?", &[("keep", "Keep"), ("drop", "Drop")], &[]);

    assert!(matches!(
        f.store
            .accept_message(&f.project, &request, Actor::Human, Utc::now()),
        Err(AgboardError::AiOnly { .. })
    ));
    assert!(matches!(
        f.store
            .accept_message(&f.project, &question, Actor::Ai, Utc::now()),
        Err(AgboardError::QuestionOpen { .. })
    ));

    let accepted = f
        .store
        .accept_message(&f.project, &request, Actor::Ai, Utc::now())
        .unwrap();
    let Accepted::Request(accepted) = accepted else {
        panic!("a request")
    };
    assert_eq!(accepted.status, RequestStatus::Accepted);
    let text = f.file(&request);
    assert!(!text.contains("acceptedAt: null") && !text.contains("acceptedBy"));

    let second = f
        .store
        .accept_message(&f.project, &request, Actor::Ai, Utc::now())
        .unwrap_err();
    assert!(matches!(second, AgboardError::RequestAccepted { .. }));
    assert_eq!(f.file(&request), text);
    // An accepted request is closed: it cannot be withdrawn.
    assert!(matches!(
        f.withdraw(&request, Actor::Human),
        Err(AgboardError::MessageClosed { .. })
    ));

    let withdrawn = f.send("Never mind.");
    f.withdraw(&withdrawn, Actor::Human).unwrap();
    assert!(matches!(
        f.store
            .accept_message(&f.project, &withdrawn, Actor::Ai, Utc::now()),
        Err(AgboardError::RequestWithdrawn { .. })
    ));
}

#[test]
fn an_answer_is_accepted_once_and_a_chat_answer_is_accepted_as_it_is_written() {
    let f = fixture();
    let ui = f.ask("Keep?", &[("keep", "Keep"), ("drop", "Drop")], &[]);
    let open = f.ask("Which name?", &[], &[]);
    f.answer(&ui, Some("keep"), None).unwrap();
    assert!(!f.file(&ui).contains("acceptedAt"));

    assert!(matches!(
        f.store
            .accept_message(&f.project, &ui, Actor::Human, Utc::now()),
        Err(AgboardError::AiOnly { .. })
    ));
    assert!(matches!(
        f.store
            .accept_message(&f.project, &open, Actor::Ai, Utc::now()),
        Err(AgboardError::QuestionOpen { .. })
    ));
    let Accepted::Question(view) = f
        .store
        .accept_message(&f.project, &ui, Actor::Ai, Utc::now())
        .unwrap()
    else {
        panic!("a question")
    };
    assert!(view.reply.unwrap().accepted_at.is_some());
    let text = f.file(&ui);
    assert!(text.contains("  acceptedAt: "), "{text}");
    assert!(matches!(
        f.store
            .accept_message(&f.project, &ui, Actor::Ai, Utc::now()),
        Err(AgboardError::AnswerAccepted { .. })
    ));
    assert_eq!(f.file(&ui), text);

    // An answer an agent writes back from its chat is in its hands already.
    let chat = f.ask("Which colour?", &[], &[]);
    f.store
        .answer_questions(
            &f.project,
            vec![AnswerItem {
                question_id: chat.clone(),
                choice_id: None,
                text: Some("Blue".into()),
            }],
            AnswerVia::Chat,
            Utc::now(),
        )
        .unwrap();
    assert!(f.file(&chat).contains("  acceptedAt: "));

    // The waits accept what they hand over, and only that.
    let later = f.ask("Ship it?", &[], &[]);
    f.answer(&later, None, Some("Yes")).unwrap();
    let ids = vec![open.clone(), ui.clone(), later.clone()];
    let written = f
        .store
        .accept_answers(&f.project, &ids, Utc::now())
        .unwrap();
    assert_eq!(written, vec![later.clone()]);
    assert!(!f.file(&open).contains("acceptedAt"));
}

#[test]
fn two_agents_never_both_take_one_request() {
    let f = fixture();
    let request = f.send("Add a reset link.");
    let winners: usize = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let store = FileStore::open(&f.shared);
                let (project, request) = (f.project.clone(), request.clone());
                scope.spawn(move || {
                    store
                        .accept_message(&project, &request, Actor::Ai, Utc::now())
                        .is_ok()
                })
            })
            .collect();
        handles
            .into_iter()
            .filter(|_| true)
            .map(|h| h.join().unwrap() as usize)
            .sum()
    });
    assert_eq!(winners, 1);
}

#[test]
fn a_request_keeps_its_images_next_to_it() {
    let f = fixture();
    let sent = f
        .store
        .send_request(
            &f.project,
            SendRequestInput {
                text: "See ![](attachments/login.png)".into(),
                images: vec![RequestImage {
                    name: "login.png".into(),
                    bytes: PNG.to_vec(),
                }],
            },
            Utc::now(),
        )
        .unwrap();
    let dir = f.project_dir().join("qa").join(&sent.id);
    assert_eq!(fs::read(dir.join("attachments/login.png")).unwrap(), PNG);
    assert!(
        f.file(&sent.id)
            .ends_with("See ![](attachments/login.png)\n")
    );

    let send = |text: &str, images: Vec<RequestImage>| {
        f.store.send_request(
            &f.project,
            SendRequestInput {
                text: text.into(),
                images,
            },
            Utc::now(),
        )
    };
    let image = |name: &str, bytes: &[u8]| RequestImage {
        name: name.into(),
        bytes: bytes.to_vec(),
    };
    assert!(send("x", vec![image("a.png", PNG), image("a.png", PNG)]).is_err());
    assert!(send("x", vec![image("notes.txt", b"hello")]).is_err());
    assert!(send("x", vec![image("../up.png", PNG)]).is_ok());
    assert!(send("x", vec![image(".hidden.png", PNG)]).is_err());
    assert!(send("   ", vec![]).is_err());
    assert!(send(&"x".repeat(20_001), vec![]).is_err());
}

#[test]
fn a_task_waits_for_an_unanswered_question_and_for_nothing_else() {
    let f = fixture();
    let task = f.task("Import");
    let request = f.send("Add a link.");
    let question = f.ask("Keep?", &[("keep", "Keep"), ("drop", "Drop")], &[task]);
    let state = |f: &Fixture| f.store.task(&f.project, task).unwrap().agent_status;
    assert_eq!(state(&f), RunState::Pending);

    f.answer(&question, Some("keep"), None).unwrap();
    assert_eq!(state(&f), RunState::Idle);

    let second = f.ask("Drop?", &[("yes", "Yes"), ("no", "No")], &[task]);
    assert_eq!(state(&f), RunState::Pending);
    f.withdraw(&second, Actor::Ai).unwrap();
    assert_eq!(state(&f), RunState::Idle);

    // A request is not a question: a task cannot refer to one.
    let err = f
        .store
        .link_questions(
            &f.project,
            task,
            std::slice::from_ref(&request),
            true,
            Actor::Ai,
            Utc::now(),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::MessageTypeMismatch { .. }));

    // A question file that cannot be read keeps the task waiting.
    let third = f.ask("Ship?", &[("yes", "Yes"), ("no", "No")], &[task]);
    f.answer(&third, Some("yes"), None).unwrap();
    assert_eq!(state(&f), RunState::Idle);
    fs::write(
        f.project_dir().join("qa").join(&third).join("QA.md"),
        "broken",
    )
    .unwrap();
    assert_eq!(state(&f), RunState::Pending);
}

#[test]
fn linking_keeps_the_question_and_the_task_in_step() {
    let f = fixture();
    let first = f.task("First");
    let second = f.task("Second");
    let question = f.ask("Keep?", &[("keep", "Keep"), ("drop", "Drop")], &[first]);
    assert!(f.file(&question).contains(&format!("tasks:\n- {first}\n")));

    f.store
        .link_questions(
            &f.project,
            second,
            std::slice::from_ref(&question),
            true,
            Actor::Ai,
            Utc::now(),
        )
        .unwrap();
    let both = format!("tasks:\n- {first}\n- {second}\n");
    assert!(f.file(&question).contains(&both), "{}", f.file(&question));
    assert_eq!(
        f.store.task(&f.project, second).unwrap().agent_status,
        RunState::Pending
    );
    f.store
        .link_questions(
            &f.project,
            first,
            std::slice::from_ref(&question),
            false,
            Actor::Ai,
            Utc::now(),
        )
        .unwrap();
    assert!(f.file(&question).contains(&format!("tasks:\n- {second}\n")));
    assert_eq!(
        f.store.task(&f.project, first).unwrap().agent_status,
        RunState::Idle
    );
    assert!(matches!(
        f.store.link_questions(
            &f.project,
            first,
            &["Q-77".into()],
            true,
            Actor::Ai,
            Utc::now()
        ),
        Err(AgboardError::MessageNotFound { .. })
    ));
}

#[test]
fn messages_are_listed_and_shown_by_kind() {
    let f = fixture();
    let question = f.ask("Keep?", &[("keep", "Keep"), ("drop", "Drop")], &[]);
    let request = f.send("Add a link.");
    let all = f.store.messages(&f.project).unwrap();
    assert_eq!(all.len(), 2);
    assert!(matches!(&all[0], MessageView::Question(q) if q.id == question));
    assert!(matches!(&all[1], MessageView::Request(r) if r.id == request));
    assert_eq!(all[0].state(), "open");
    assert!(matches!(
        f.store.question(&f.project, &request),
        Err(AgboardError::MessageTypeMismatch { .. })
    ));
    assert!(matches!(
        f.store.request(&f.project, &question),
        Err(AgboardError::MessageTypeMismatch { .. })
    ));
    f.answer(&question, Some("keep"), None).unwrap();
    assert_eq!(f.store.messages(&f.project).unwrap()[0].state(), "closed");
    assert_eq!(f.store.questions(&f.project).unwrap().len(), 1);
}

#[test]
fn a_refused_ask_writes_nothing_and_reserves_no_number() {
    let f = fixture();
    let task = f.task("Import");
    let draft = f
        .store
        .create_task(
            &f.project,
            NewTask {
                title: "Draft".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                draft: Some(agent_board::domain::Draft::Human),
            },
            Utc::now(),
        )
        .unwrap()
        .id;
    let ask = |actor: Actor, questions: Vec<AskQuestion>, tasks: Vec<i64>| {
        f.store.ask_questions(
            &f.project,
            AskInput {
                actor,
                asked_by: None,
                questions,
                tasks,
            },
            Utc::now(),
        )
    };
    let q = |body: &str, choices: &[(&str, &str)], recommended: Option<&str>| AskQuestion {
        body: body.into(),
        choices: qa::choices(choices),
        recommended_choice_id: recommended.map(str::to_string),
        tasks: Vec::new(),
    };
    let two = [("a", "A"), ("b", "B")];
    assert!(matches!(
        ask(Actor::Human, vec![q("Ok?", &two, None)], vec![task]),
        Err(AgboardError::AiOnly { .. })
    ));
    for bad in [
        vec![],
        vec![q("   ", &two, None)],
        vec![q("One choice?", &[("a", "A")], None)],
        vec![q("Unknown pick?", &two, Some("c"))],
        (0..21).map(|n| q(&format!("Q{n}?"), &two, None)).collect(),
    ] {
        assert!(matches!(
            ask(Actor::Ai, bad, vec![task]),
            Err(AgboardError::InvalidValue { .. })
        ));
    }
    assert!(matches!(
        ask(Actor::Ai, vec![q("Ok?", &two, None)], vec![task + 40]),
        Err(AgboardError::TaskNotFound { .. })
    ));
    assert!(matches!(
        ask(Actor::Ai, vec![q("Ok?", &two, None)], vec![draft]),
        Err(AgboardError::TaskIsDraft { .. })
    ));

    assert!(
        !f.project_dir().join("qa").exists()
            || fs::read_dir(f.project_dir().join("qa"))
                .unwrap()
                .next()
                .is_none()
    );
    let project: serde_json::Value =
        serde_json::from_slice(&fs::read(f.project_dir().join("project.json")).unwrap()).unwrap();
    assert_eq!(project["nextQuestionId"], 1);
    assert_eq!(f.ask("Fine?", &two, &[task]), "Q-1");
}
