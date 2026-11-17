//! Who owns a draft: `draft` is none, `human` or `ai`. An agent creates AI drafts, an agent can
//! still edit them, and only a person starts them (one task, or an epic with its AI drafts).
//! Every test uses a temporary data area; servers listen on port 0.

mod common;

use std::fs;
use std::path::Path;

use agent_board::domain::{Actor, Assignee, Draft, NewTask, ProjectId};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::file_store::model::{EpicUpdate, NewEpic};
use agent_board::file_store::validate::EpicId;
use chrono::{TimeZone, Utc};
use common::{Running, agboard, demo_project, json_error, json_ok};
use serde_json::{Value, json};

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
fn what_an_agent_creates_is_an_ai_draft_and_what_a_person_creates_is_not() {
    let f = fx();
    let by_ai = f.task(Actor::Ai, Assignee::Ai, None);
    let by_ai_for_a_person = f.task(Actor::Ai, Assignee::Human, None);
    let by_person = f.task(Actor::Human, Assignee::Ai, None);
    let by_person_draft = f.task(Actor::Human, Assignee::Human, Some(Draft::Human));
    assert_eq!(f.draft_of(by_ai), Some(Draft::Ai));
    assert_eq!(f.draft_of(by_ai_for_a_person), Some(Draft::Ai));
    assert_eq!(f.draft_of(by_person), None);
    assert_eq!(f.draft_of(by_person_draft), Some(Draft::Human));
}

fn project_id(home: &Path) -> String {
    json_ok(home, &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn the_cli_creates_ai_drafts_that_an_agent_can_edit_but_not_move() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let run = |args: &[&str]| {
        let mut all = vec!["--project", "Demo"];
        all.extend(args);
        json_ok(home.path(), &all)
    };
    let added = run(&[
        "add",
        "Plan",
        "--assignee",
        "human",
        "--actor",
        "ai",
        "--json",
    ]);
    assert_eq!(added["task"]["draft"], "ai");
    let id = added["task"]["id"].to_string();
    let id = id.as_str();
    let human = run(&[
        "add",
        "Mine",
        "--assignee",
        "ai",
        "--actor",
        "human",
        "--json",
    ]);
    assert_eq!(human["task"]["draft"], Value::Null);
    let epic = run(&[
        "epic", "add", "NEW", "--name", "New", "--actor", "ai", "--json",
    ]);
    assert_eq!(epic["epic"]["draft"], "ai");

    // An agent edits the proposal and notes progress, including joining the AI epic.
    let edited = run(&[
        "edit",
        id,
        "--title",
        "Better plan",
        "--epic",
        "NEW",
        "--json",
    ]);
    assert_eq!(edited["task"]["title"], "Better plan");
    assert_eq!(edited["task"]["draft"], "ai");
    run(&["history", "add", id, "--reason", "Refined", "--json"]);
    run(&["epic", "edit", "NEW", "--name", "Renamed", "--json"]);

    // It cannot move it or report a run state.
    for args in [
        vec![
            "mv", id, "doing", "--actor", "ai", "--reason", "go", "--json",
        ],
        vec![
            "state", id, "running", "--actor", "ai", "--reason", "go", "--json",
        ],
    ] {
        let mut all = vec!["--project", "Demo"];
        all.extend(args);
        let (code, name) = json_error(home.path(), &all);
        assert_eq!((code, name.as_str()), (1, "task_is_draft"));
    }
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

#[test]
fn a_person_starts_one_task_and_the_history_says_so() {
    let f = fx();
    let id = f.task(Actor::Ai, Assignee::Ai, None);
    let other = f.task(Actor::Ai, Assignee::Ai, None);

    let started = f
        .store
        .start_task(&f.project, id, Actor::Human, now())
        .unwrap();
    assert!(started.changed);
    assert_eq!(started.value.draft, None);
    assert!(
        started
            .value
            .history
            .last()
            .unwrap()
            .reason
            .contains("A person started"),
        "{:?}",
        started.value.history
    );
    assert_eq!(f.draft_of(other), Some(Draft::Ai), "only that task starts");

    let again = f
        .store
        .start_task(&f.project, id, Actor::Human, now())
        .unwrap();
    assert!(!again.changed);

    // After the start an agent can work on it.
    f.store
        .move_work_task(
            &f.project,
            id,
            agent_board::domain::Column::Doing,
            agent_board::domain::ChangeContext {
                actor: Actor::Ai,
                reason: "go".into(),
            },
            now(),
        )
        .unwrap();
}

#[test]
fn only_a_person_can_start_and_an_agent_is_refused_without_a_change() {
    let f = fx();
    let id = f.task(Actor::Ai, Assignee::Ai, None);
    let epic = f.epic("E1", Some(Draft::Ai));
    assert!(matches!(
        f.store.start_task(&f.project, id, Actor::Ai, now()),
        Err(AgboardError::HumanOnly { .. })
    ));
    assert!(matches!(
        f.store.start_epic(&f.project, &epic, Actor::Ai, now()),
        Err(AgboardError::HumanOnly { .. })
    ));
    assert_eq!(f.draft_of(id), Some(Draft::Ai));
    assert_eq!(
        f.store.epic(&f.project, &epic).unwrap().draft,
        Some(Draft::Ai)
    );

    // A person's own draft is finalized, not started.
    let mine = f.task(Actor::Human, Assignee::Ai, Some(Draft::Human));
    assert!(matches!(
        f.store.start_task(&f.project, mine, Actor::Human, now()),
        Err(AgboardError::TaskIsDraft { .. })
    ));
}

#[test]
fn starting_an_epic_clears_it_and_its_ai_drafts_together_and_leaves_a_persons_drafts() {
    let f = fx();
    let epic = f.epic("PLAN", Some(Draft::Ai));
    let ai_one = f.task(Actor::Ai, Assignee::Ai, None);
    let ai_two = f.task(Actor::Ai, Assignee::Human, None);
    let mine = f.task(Actor::Human, Assignee::Ai, Some(Draft::Human));
    let outside = f.task(Actor::Ai, Assignee::Ai, None);
    for id in [ai_one, ai_two, mine, outside] {
        f.store
            .set_task_epic(
                &f.project,
                id,
                (id != outside).then_some(&epic),
                Actor::Human,
                now(),
            )
            .unwrap();
    }

    let started = f
        .store
        .start_epic(&f.project, &epic, Actor::Human, now())
        .unwrap();
    assert!(started.changed);
    assert_eq!(started.value.epic.draft, None);
    assert_eq!(started.value.started, vec![ai_one, ai_two]);
    assert_eq!(f.draft_of(ai_one), None);
    assert_eq!(f.draft_of(ai_two), None);
    assert_eq!(
        f.draft_of(mine),
        Some(Draft::Human),
        "a person's draft stays"
    );
    assert_eq!(
        f.draft_of(outside),
        Some(Draft::Ai),
        "other epics are untouched"
    );
    for id in [ai_one, ai_two] {
        let task = f.store.task(&f.project, id).unwrap();
        assert!(
            task.history
                .last()
                .unwrap()
                .reason
                .contains("A person started")
        );
    }

    let again = f
        .store
        .start_epic(&f.project, &epic, Actor::Human, now())
        .unwrap();
    assert!(!again.changed);
}

#[test]
fn an_agent_task_added_to_a_running_epic_is_started_with_the_epic() {
    let f = fx();
    let epic = f.epic("LIVE", None);
    let id = f.task(Actor::Ai, Assignee::Ai, None);
    f.store
        .set_task_epic(&f.project, id, Some(&epic), Actor::Ai, now())
        .unwrap();
    let started = f
        .store
        .start_epic(&f.project, &epic, Actor::Human, now())
        .unwrap();
    assert_eq!(started.value.started, vec![id]);
    assert_eq!(f.draft_of(id), None);
}

#[test]
fn an_epic_edit_cannot_clear_an_ai_draft_but_a_person_draft_epic_still_refuses_the_cli() {
    let f = fx();
    let epic = f.epic("AI", Some(Draft::Ai));
    let update = |draft| EpicUpdate {
        draft: Some(draft),
        ..EpicUpdate::default()
    };
    assert!(matches!(
        f.store.update_epic(&f.project, &epic, update(None), now()),
        Err(AgboardError::AiDraftNeedsStart { .. })
    ));
    let mine = f.epic("MINE", Some(Draft::Human));
    let refuse = EpicUpdate {
        name: Some("x".into()),
        refuse_if_draft: true,
        ..EpicUpdate::default()
    };
    assert!(matches!(
        f.store.update_epic(&f.project, &mine, refuse, now()),
        Err(AgboardError::EpicIsDraft { .. })
    ));
}

#[test]
fn the_cli_start_commands_need_a_person() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let run = |args: &[&str]| {
        let mut all = vec!["--project", "Demo"];
        all.extend(args);
        json_ok(home.path(), &all)
    };
    run(&[
        "epic", "add", "PLAN", "--name", "Plan", "--actor", "ai", "--json",
    ]);
    run(&[
        "add",
        "A",
        "--assignee",
        "ai",
        "--actor",
        "ai",
        "--epic",
        "PLAN",
        "--json",
    ]);
    run(&["add", "B", "--assignee", "ai", "--actor", "ai", "--json"]);

    let (code, name) = json_error(
        home.path(),
        &["--project", "Demo", "start", "3", "--actor", "ai", "--json"],
    );
    assert_eq!((code, name.as_str()), (1, "human_only"));
    let (code, name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "start",
            "PLAN",
            "--actor",
            "ai",
            "--json",
        ],
    );
    assert_eq!((code, name.as_str()), (1, "human_only"));

    let started = run(&["epic", "start", "plan", "--actor", "human", "--json"]);
    assert_eq!(started["epic"]["draft"], Value::Null);
    assert_eq!(started["started"], json!([2]));
    let task = run(&["start", "3", "--actor", "human", "--json"]);
    assert_eq!(task["task"]["draft"], Value::Null);
    // Now the agent can move it.
    let moved = run(&[
        "mv", "3", "doing", "--actor", "ai", "--reason", "go", "--json",
    ]);
    assert_eq!(moved["task"]["taskStatus"], "doing");
    let (code, _, _) = agboard(
        home.path(),
        &["--project", "Demo", "start", "3", "--actor", "human"],
    );
    assert_eq!(
        code, 0,
        "starting a task that is not a draft is not an error"
    );
}

#[test]
fn the_api_starts_tasks_and_epics_and_keeps_an_ai_draft_after_a_persons_edit() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    for args in [
        vec!["epic", "add", "PLAN", "--name", "Plan", "--actor", "ai"],
        vec![
            "add",
            "A",
            "--assignee",
            "ai",
            "--actor",
            "ai",
            "--epic",
            "PLAN",
        ],
        vec!["add", "B", "--assignee", "human", "--actor", "ai"],
        vec!["add", "C", "--assignee", "ai", "--actor", "ai"],
    ] {
        let mut all = vec!["--project", "Demo"];
        all.extend(args);
        json_ok(home.path(), &[&all[..], &["--json"]].concat());
    }
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let task = |id: i64| format!("/api/projects/{pid}/tasks/{id}");

    // Creating an AI draft over the API is refused.
    let reply = server.write(
        "POST",
        &format!("/api/projects/{pid}/tasks"),
        Some(r#"{"title":"x","description":"","assignee":"ai","draft":"ai"}"#),
    );
    assert_eq!(reply.status, 422, "{}", reply.body);

    // A person edits the proposal: it becomes theirs, then goes back to the AI draft.
    let reply = server.write(
        "PUT",
        &format!("{}/draft", task(3)),
        Some(r#"{"draft":"human"}"#),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["draft"], "human");
    let reply = server.write(
        "PATCH",
        &task(3),
        Some(r#"{"title":"Edited by a person","draft":"ai"}"#),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["draft"], "ai");
    assert_eq!(reply.json()["task"]["title"], "Edited by a person");
    // An edit that does not move the draft away from "ai" is also fine, but finalizing is not.
    let reply = server.write("PATCH", &task(3), Some(r#"{"finalize":true}"#));
    assert_eq!(reply.status, 409, "{}", reply.body);
    assert_eq!(reply.code(), "ai_draft_needs_start");
    let reply = server.write(
        "PUT",
        &format!("{}/draft", task(3)),
        Some(r#"{"draft":null}"#),
    );
    assert_eq!(reply.status, 409, "{}", reply.body);
    assert_eq!(reply.code(), "ai_draft_needs_start");

    // Start one task, then the epic.
    let reply = server.write("POST", &format!("{}/start", task(4)), None);
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["draft"], Value::Null);
    let reply = server.write(
        "POST",
        &format!("/api/projects/{pid}/epics/PLAN/start"),
        None,
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["epic"]["draft"], Value::Null);
    assert_eq!(reply.json()["started"], json!([2]));
    let summary = server.get(&format!("/api/projects/{pid}/summary"));
    let tasks = summary.json()["tasks"].as_array().unwrap().clone();
    let draft = |id: i64| tasks.iter().find(|t| t["id"] == id).unwrap()["draft"].clone();
    assert_eq!(draft(2), Value::Null);
    assert_eq!(draft(3), "ai");
    assert_eq!(draft(4), Value::Null);

    let reply = server.write(
        "POST",
        &format!("/api/projects/{pid}/epics/NOPE/start"),
        None,
    );
    assert_eq!(reply.status, 404, "{}", reply.body);
    server.stop();
}

#[test]
fn moving_a_draft_says_who_it_waits_for() {
    let f = fx();
    let ai = f.task(Actor::Ai, Assignee::Ai, Some(Draft::Ai));
    let human = f.task(Actor::Human, Assignee::Ai, Some(Draft::Human));
    let reason = |id: i64| {
        let ctx = agent_board::domain::ChangeContext {
            actor: Actor::Ai,
            reason: "go".into(),
        };
        f.store
            .move_work_task(
                &f.project,
                id,
                agent_board::domain::Column::Doing,
                ctx,
                now(),
            )
            .unwrap_err()
    };
    let err = reason(ai);
    assert_eq!(err.code(), "task_is_draft");
    assert!(
        err.reason().contains("person to start it"),
        "{}",
        err.reason()
    );
    let err = reason(human);
    assert_eq!(err.code(), "task_is_draft");
    assert!(
        err.reason().contains("user to finalize"),
        "{}",
        err.reason()
    );
}
