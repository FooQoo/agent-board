//! The Backlog: a plan an agent makes is saved there, saving it never moves it, and only
//! sending it to Todo hands it over. Every test uses a temporary data area.

mod common;

#[path = "support/qa.rs"]
mod qa;

use std::fs;
use std::path::PathBuf;

use agent_board::domain::{
    Actor, Assignee, AttachmentInput, ChangeContext, Column, Draft, NewTask, ProjectId,
};
use agent_board::file_store::model::{AttachmentOwner, NewEpic};
use agent_board::file_store::validate::EpicId;
use agent_board::file_store::{DraftSave, FileStore, ImageChanges};
use chrono::{TimeZone, Utc};
use serde_json::{Value, json};

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 21, 0, 0, 0).unwrap()
}

struct Fx {
    _root: tempfile::TempDir,
    shared: PathBuf,
    store: FileStore,
    project: ProjectId,
    dir: PathBuf,
}

fn fx() -> Fx {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Alpha", now()).unwrap().id;
    let dir = shared.join("projects").join(project.as_str());
    Fx {
        _root: root,
        shared,
        store,
        project,
        dir,
    }
}

impl Fx {
    fn plan(&self, title: &str) -> i64 {
        self.store
            .create_task_in_backlog(
                &self.project,
                NewTask {
                    title: title.into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                    draft: None,
                },
                now(),
            )
            .unwrap()
            .id
    }

    fn human_task(&self, title: &str) -> i64 {
        self.store
            .create_task(
                &self.project,
                NewTask {
                    title: title.into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Human,
                    draft: None,
                },
                now(),
            )
            .unwrap()
            .id
    }

    fn epic(&self, id: &str) -> EpicId {
        self.store
            .create_epic(
                &self.project,
                NewEpic {
                    id: id.into(),
                    name: "Epic".into(),
                    color: None,
                    draft: None,
                    document: None,
                },
                now(),
            )
            .unwrap()
            .id
    }

    fn join(&self, task: i64, epic: &EpicId) {
        self.store
            .set_task_epic(&self.project, task, Some(epic), Actor::Human, now())
            .unwrap();
    }

    fn lane(&self, id: i64) -> Column {
        self.store.task(&self.project, id).unwrap().task_status
    }

    fn task_json(&self, id: i64) -> Value {
        let path = self.dir.join(format!("tasks/{id}/task.json"));
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }
}

#[test]
fn a_plan_only_request_is_created_in_the_backlog_and_an_execute_request_in_todo() {
    let f = fx();
    let plan = f.plan("Plan");
    let execute = f.human_task("Execute");
    let task = f.store.task(&f.project, plan).unwrap();
    assert_eq!((task.task_status, task.draft), (Column::Backlog, None));
    assert_eq!(f.lane(execute), Column::Todo);

    // An agent's ordinary `add` is a normal Todo task, as before the Backlog existed.
    let by_agent = f
        .store
        .create_task(
            &f.project,
            NewTask {
                title: "By an agent".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                draft: None,
            },
            now(),
        )
        .unwrap();
    assert_eq!((by_agent.task_status, by_agent.draft), (Column::Todo, None));

    // Only a file that uses the Backlog carries formatVersion 2; a card in Todo keeps 1.
    assert_eq!(f.task_json(plan)["formatVersion"], 2);
    assert_eq!(f.task_json(plan)["taskStatus"], "backlog");
    assert_eq!(f.task_json(execute)["formatVersion"], 1);
}

#[test]
fn saving_and_answering_never_move_a_plan_and_it_is_all_there_after_a_restart() {
    let f = fx();
    let id = f.plan("Plan");
    let question = qa::ask(&f.store, &f.project, &[id], "Which way?", &[]);

    // A person edits (the lock), saves, and finalizes: the card stays in the Backlog.
    f.store
        .set_draft(&f.project, id, Some(Draft::Human), false, now())
        .unwrap();
    let saved = f
        .store
        .edit_draft_task(
            &f.project,
            id,
            Some("Better plan"),
            Some("## 作業内容\n\nRead this.\n"),
            true,
            now(),
        )
        .unwrap();
    assert_eq!(saved.value.task_status, Column::Backlog);
    assert_eq!(saved.value.draft, None);
    qa::answer(&f.store, &f.project, &question.id, None, Some("Plan A."));
    assert_eq!(f.lane(id), Column::Backlog, "an answer is not a start");

    // A restart reads everything again from the files.
    let reopened = FileStore::open(&f.shared);
    let task = reopened.task(&f.project, id).unwrap();
    assert_eq!(task.task_status, Column::Backlog);
    assert_eq!(task.title, "Better plan");
    assert!(task.description.contains("Read this."));
    assert!(!task.history.is_empty());
    assert_eq!(task.question_ids, vec![question.id.clone()]);
}

#[test]
fn only_a_person_sends_a_plan_and_an_agent_is_refused() {
    let f = fx();
    let first = f.plan("First");
    let second = f.plan("Second");

    let refused = f
        .store
        .send_task(&f.project, first, Actor::Ai, false, now())
        .unwrap_err();
    assert_eq!(refused.code(), "human_only");
    assert_eq!(f.lane(first), Column::Backlog);

    let sent = f
        .store
        .send_task(&f.project, second, Actor::Human, false, now())
        .unwrap();
    assert!(sent.changed);
    assert_eq!(sent.value.task_status, Column::Todo);
    assert!(
        sent.value
            .history
            .last()
            .unwrap()
            .reason
            .contains("A person")
    );
    let sent_first = f
        .store
        .send_task(&f.project, first, Actor::Human, false, now())
        .unwrap();
    // Todo is ordered by the send: the second one is last.
    assert!(sent_first.value.position > f.store.task(&f.project, second).unwrap().position);

    // A retry changes nothing.
    let again = f
        .store
        .send_task(&f.project, first, Actor::Human, false, now())
        .unwrap();
    assert!(!again.changed);
}

#[test]
fn an_open_question_is_a_warning_a_person_confirms() {
    let f = fx();
    let id = f.plan("Plan");
    let q = qa::ask(&f.store, &f.project, &[id], "Which way?", &[]);

    let warned = f
        .store
        .send_task(&f.project, id, Actor::Human, false, now())
        .unwrap_err();
    assert_eq!(warned.code(), "send_with_open_questions");
    assert_eq!(f.lane(id), Column::Backlog);

    // The person confirms. The question stays, so the agent cannot run it yet.
    f.store
        .send_task(&f.project, id, Actor::Human, true, now())
        .unwrap();
    assert_eq!(f.lane(id), Column::Todo);
    let view = f.store.task(&f.project, id).unwrap();
    assert_eq!(view.open_question_ids, vec![q.id.clone()]);
    // It waits for the answer in Todo, so no agent can run it.
    assert_eq!(view.agent_status, agent_board::domain::RunState::Pending);
}

#[test]
fn a_card_a_person_is_editing_is_not_sent_and_the_edit_is_kept() {
    let f = fx();
    let id = f.plan("Plan");
    f.store
        .set_draft(&f.project, id, Some(Draft::Human), false, now())
        .unwrap();
    for actor in [Actor::Human, Actor::Ai] {
        let refused = f
            .store
            .send_task(&f.project, id, actor, false, now())
            .unwrap_err();
        assert_eq!(refused.code(), "task_is_draft");
    }
    let task = f.store.task(&f.project, id).unwrap();
    assert_eq!(task.task_status, Column::Backlog);
    assert_eq!(task.draft, Some(Draft::Human));
}

#[test]
fn an_epic_is_sent_whole_or_by_chosen_cards_and_a_failure_sends_nothing() {
    let f = fx();
    let epic = f.epic("PLAN");
    let a = f.plan("A");
    let b = f.plan("B");
    let c = f.plan("C");
    for id in [a, b, c] {
        f.join(id, &epic);
    }

    // A person sends the chosen cards only; the rest stay in the Backlog.
    let sent = f
        .store
        .send_epic(&f.project, &epic, Some(&[b]), Actor::Human, false, now())
        .unwrap();
    assert_eq!(sent.value.sent, vec![b]);
    assert_eq!(f.lane(a), Column::Backlog);
    assert_eq!(f.lane(b), Column::Todo);

    // A card outside the epic is refused and nothing moves.
    let outside = f.plan("Outside");
    let refused = f
        .store
        .send_epic(
            &f.project,
            &epic,
            Some(&[a, outside]),
            Actor::Human,
            false,
            now(),
        )
        .unwrap_err();
    assert_eq!(refused.code(), "invalid_value");
    assert_eq!(f.lane(a), Column::Backlog);

    // One card being edited stops the whole send.
    f.store
        .set_draft(&f.project, c, Some(Draft::Human), false, now())
        .unwrap();
    let refused = f
        .store
        .send_epic(&f.project, &epic, None, Actor::Human, false, now())
        .unwrap_err();
    assert_eq!(refused.code(), "task_is_draft");
    assert_eq!(f.lane(a), Column::Backlog);
    f.store.set_draft(&f.project, c, None, true, now()).unwrap();

    // An agent cannot send an epic.
    let refused = f
        .store
        .send_epic(&f.project, &epic, None, Actor::Ai, false, now())
        .unwrap_err();
    assert_eq!(refused.code(), "human_only");
    assert_eq!(f.lane(a), Column::Backlog);

    // The person sends every Backlog card that is left. A second send changes nothing.
    let sent = f
        .store
        .send_epic(&f.project, &epic, None, Actor::Human, false, now())
        .unwrap();
    assert_eq!(sent.value.sent, vec![a, c]);
    let again = f
        .store
        .send_epic(&f.project, &epic, None, Actor::Human, false, now())
        .unwrap();
    assert!(!again.changed);
}

#[test]
fn nothing_leaves_the_backlog_by_a_move_or_a_run_state_except_a_persons_move_to_todo() {
    let f = fx();
    let id = f.plan("Plan");
    let go = |actor, to| {
        f.store.move_work_task(
            &f.project,
            id,
            to,
            ChangeContext {
                actor,
                reason: "go".into(),
            },
            now(),
        )
    };
    assert_eq!(
        go(Actor::Ai, Column::Doing).unwrap_err().code(),
        "task_in_backlog"
    );
    assert_eq!(
        go(Actor::Ai, Column::Todo).unwrap_err().code(),
        "task_in_backlog"
    );
    let state = f.store.set_agent_status(
        &f.project,
        id,
        agent_board::domain::RunState::Running,
        ChangeContext {
            actor: Actor::Ai,
            reason: "go".into(),
        },
        now(),
    );
    assert_eq!(state.unwrap_err().code(), "task_in_backlog");
    // A person cannot jump to Doing or Done either; Todo is the send.
    let user_move = |to| {
        f.store.move_work_task_for_user(
            &f.project,
            id,
            to,
            ChangeContext {
                actor: Actor::Human,
                reason: "drag".into(),
            },
            now(),
        )
    };
    assert_eq!(
        user_move(Column::Doing).unwrap_err().code(),
        "task_in_backlog"
    );
    assert_eq!(
        user_move(Column::Done).unwrap_err().code(),
        "task_in_backlog"
    );
    assert_eq!(f.lane(id), Column::Backlog);
    assert_eq!(
        user_move(Column::Todo).unwrap().value.task_status,
        Column::Todo
    );
}

#[test]
fn only_a_person_takes_an_unstarted_todo_card_back_to_the_backlog() {
    let f = fx();
    let id = f.human_task("Todo card");
    let back = |actor| {
        f.store.move_work_task(
            &f.project,
            id,
            Column::Backlog,
            ChangeContext {
                actor,
                reason: "back".into(),
            },
            now(),
        )
    };
    assert_eq!(back(Actor::Ai).unwrap_err().code(), "human_only");
    let moved = back(Actor::Human).unwrap();
    assert_eq!(moved.value.task_status, Column::Backlog);
    // An agent cannot send it again.
    assert_eq!(
        f.store
            .send_task(&f.project, id, Actor::Ai, false, now())
            .unwrap_err()
            .code(),
        "human_only"
    );

    // A started card cannot go back.
    let started = f.human_task("Started");
    f.store
        .move_work_task(
            &f.project,
            started,
            Column::Doing,
            ChangeContext {
                actor: Actor::Ai,
                reason: "go".into(),
            },
            now(),
        )
        .unwrap();
    let refused = f.store.move_work_task_for_user(
        &f.project,
        started,
        Column::Backlog,
        ChangeContext {
            actor: Actor::Human,
            reason: "back".into(),
        },
        now(),
    );
    assert!(refused.is_err());
    assert_eq!(f.lane(started), Column::Doing);
}

#[test]
fn the_agent_surfaces_ignore_the_backlog() {
    let f = fx();
    let plan = f.plan("Plan");
    let ready = f.human_task("Ready");
    let snapshot = f.store.board(&f.project).unwrap();
    let table = agent_board::progress::build(&snapshot, &f.shared, now());
    let next: Vec<i64> = table.next_tasks.iter().map(|t| t.id).collect();
    assert_eq!(
        next,
        vec![ready],
        "a plan is no candidate before it is sent"
    );
    let listed: Vec<i64> = table
        .epics
        .iter()
        .flat_map(|e| e.tasks.iter().map(|t| t.id))
        .chain(table.unassigned.iter().map(|t| t.id))
        .collect();
    assert!(!listed.contains(&plan));
    // After the send it is a candidate like any Todo card.
    f.store
        .send_task(&f.project, plan, Actor::Human, false, now())
        .unwrap();
    let snapshot = f.store.board(&f.project).unwrap();
    let table = agent_board::progress::build(&snapshot, &f.shared, now());
    let next: Vec<i64> = table.next_tasks.iter().map(|t| t.id).collect();
    assert!(next.contains(&plan));
}

#[test]
fn an_epic_waits_for_a_plan_that_is_still_in_the_backlog() {
    let f = fx();
    let epic = f.epic("WAVES");
    let first = f.plan("First");
    let second = f.human_task("Second");
    f.join(first, &epic);
    f.join(second, &epic);
    f.store
        .update_epic(
            &f.project,
            &epic,
            agent_board::file_store::model::EpicUpdate {
                document: Some("---\nwaves:\n- 1\n- 2\n---\n\n## 目的\n\nx\n".to_string()),
                ..Default::default()
            },
            now(),
        )
        .unwrap();
    let snapshot = f.store.board(&f.project).unwrap();
    let table = agent_board::progress::build(&snapshot, &f.shared, now());
    assert!(
        table.next_tasks.iter().all(|t| t.id != second),
        "wave 2 waits while wave 1 is in the Backlog"
    );
}

/// Rewrite the `task.json` of a task as an earlier version stored it.
fn legacy_task(f: &Fx, id: i64, lane: &str, archived: bool, draft: Value) {
    let path = f.dir.join(format!("tasks/{id}/task.json"));
    let mut json: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    json["taskStatus"] = json!(lane);
    json["draft"] = draft;
    json["formatVersion"] = json!(1);
    if archived {
        json["archivedAt"] = json!("2026-11-01T00:00:00Z");
    }
    fs::write(&path, serde_json::to_string_pretty(&json).unwrap()).unwrap();
}

fn marker(f: &Fx) -> PathBuf {
    f.dir.join(".internal/backlog-migrated")
}

/// Every file of the project the migration may write, with its bytes.
fn files(f: &Fx) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    for entry in walk(&f.dir.join("tasks"))
        .into_iter()
        .chain(walk(&f.dir.join("epics")))
    {
        let rel = entry.strip_prefix(&f.dir).unwrap().display().to_string();
        out.push((rel, fs::read(&entry).unwrap()));
    }
    out.sort();
    out
}

fn walk(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(read) = fs::read_dir(dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.extend(walk(&path));
            } else {
                out.push(path);
            }
        }
    }
    out
}

struct Legacy {
    todo: i64,
    doing: i64,
    done: i64,
    archived: i64,
    in_epic: i64,
    human_draft: i64,
    ordinary_todo: i64,
    ordinary_doing: i64,
    ordinary_done: i64,
    epic: EpicId,
    _plain_epic: EpicId,
}

/// A project as the previous version left it: AI drafts in every lane, an AI draft epic, a
/// person's draft, and ordinary cards.
fn legacy_project(f: &Fx) -> Legacy {
    let ids: Vec<i64> = (0..9).map(|n| f.human_task(&format!("Task {n}"))).collect();
    let epic = f.epic("OLD");
    let plain_epic = f.epic("PLAIN");
    f.join(ids[4], &epic);
    legacy_task(f, ids[0], "todo", false, json!("ai"));
    legacy_task(f, ids[1], "doing", false, json!("ai"));
    legacy_task(f, ids[2], "done", false, json!("ai"));
    legacy_task(f, ids[3], "todo", true, json!("ai"));
    legacy_task(f, ids[4], "todo", false, json!("ai"));
    legacy_task(f, ids[5], "todo", false, json!("human"));
    legacy_task(f, ids[6], "todo", false, Value::Null);
    legacy_task(f, ids[7], "doing", false, Value::Null);
    legacy_task(f, ids[8], "done", false, Value::Null);
    let path = f.dir.join("epics/OLD/epic.json");
    let mut stored: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    stored["draft"] = json!("ai");
    fs::write(&path, serde_json::to_string_pretty(&stored).unwrap()).unwrap();
    // The project is as the previous version left it: nothing has checked it yet.
    let _ = fs::remove_file(marker(f));
    Legacy {
        todo: ids[0],
        doing: ids[1],
        done: ids[2],
        archived: ids[3],
        in_epic: ids[4],
        human_draft: ids[5],
        ordinary_todo: ids[6],
        ordinary_doing: ids[7],
        ordinary_done: ids[8],
        epic,
        _plain_epic: plain_epic,
    }
}

#[test]
fn a_read_shows_an_old_ai_draft_as_the_backlog_and_writes_nothing() {
    let f = fx();
    let l = legacy_project(&f);
    let before = files(&f);

    let lane = |id: i64| f.store.task(&f.project, id).unwrap().task_status;
    assert_eq!(lane(l.todo), Column::Backlog);
    assert_eq!(lane(l.doing), Column::Backlog);
    assert_eq!(lane(l.done), Column::Done);
    assert_eq!(lane(l.ordinary_todo), Column::Todo);
    let task = f.store.task(&f.project, l.todo).unwrap();
    assert_eq!(task.draft, None);
    let after = files(&f);
    for (name, bytes) in &before {
        assert!(
            after.iter().any(|(n, b)| n == name && b == bytes),
            "{name} was rewritten by a read"
        );
    }
    assert!(!marker(&f).exists());
}

#[test]
fn the_first_write_moves_every_old_ai_draft_once_and_a_second_run_changes_nothing() {
    let f = fx();
    let l = legacy_project(&f);

    // Any change of the project is the first write.
    f.store
        .add_history(&f.project, l.ordinary_todo, Some("note"), now())
        .unwrap();

    let view = |id: i64| f.store.task(&f.project, id).unwrap();
    // Todo and Doing drafts become plans in the Backlog and record the move.
    for id in [l.todo, l.doing] {
        let task = view(id);
        assert_eq!(task.task_status, Column::Backlog, "#{id}");
        assert_eq!(task.draft, None);
        assert!(
            task.history.last().unwrap().reason.contains("Backlog"),
            "{:?}",
            task.history.last()
        );
        assert_eq!(f.task_json(id)["formatVersion"], 2);
        assert_eq!(f.task_json(id)["draft"], Value::Null);
    }
    assert_eq!(view(l.in_epic).task_status, Column::Backlog);
    // Done and archived keep their place and only lose the AI draft.
    assert_eq!(view(l.done).task_status, Column::Done);
    assert_eq!(view(l.done).draft, None);
    let archived = view(l.archived);
    assert_eq!(archived.task_status, Column::Todo);
    assert!(archived.archived_at.is_some());
    assert_eq!(archived.draft, None);
    // The epic loses its AI draft.
    assert_eq!(f.store.epic(&f.project, &l.epic).unwrap().draft, None);
    // A person's draft and the ordinary cards are not changed.
    assert_eq!(view(l.human_draft).draft, Some(Draft::Human));
    assert_eq!(view(l.human_draft).task_status, Column::Todo);
    assert_eq!(view(l.ordinary_todo).task_status, Column::Todo);
    assert_eq!(view(l.ordinary_doing).task_status, Column::Doing);
    assert_eq!(view(l.ordinary_done).task_status, Column::Done);
    assert_eq!(f.task_json(l.ordinary_todo)["formatVersion"], 1);
    assert!(marker(&f).exists());

    // A past plan is not startable by the update alone: an agent cannot send it.
    assert_eq!(
        f.store
            .send_task(&f.project, l.todo, Actor::Ai, false, now())
            .unwrap_err()
            .code(),
        "human_only"
    );
    let table = agent_board::progress::build(&f.store.board(&f.project).unwrap(), &f.shared, now());
    assert!(
        table
            .next_tasks
            .iter()
            .all(|t| t.id != l.todo && t.id != l.doing)
    );

    // Running it again, even with the marker gone, finds no AI draft and changes nothing.
    let after_first = files(&f);
    fs::remove_file(marker(&f)).unwrap();
    f.store
        .add_history(&f.project, l.ordinary_doing, Some("again"), now())
        .unwrap();
    let after_second: Vec<_> = files(&f)
        .into_iter()
        .filter(|(name, _)| !name.contains(&format!("tasks/{}/", l.ordinary_doing)))
        .collect();
    let expected: Vec<_> = after_first
        .into_iter()
        .filter(|(name, _)| !name.contains(&format!("tasks/{}/", l.ordinary_doing)))
        .collect();
    assert_eq!(after_second, expected);
    assert!(marker(&f).exists());
}

#[test]
fn a_newer_file_format_is_left_out_like_any_other_unsupported_version() {
    let f = fx();
    let id = f.plan("Plan");
    let path = f.dir.join(format!("tasks/{id}/task.json"));
    let mut json: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    json["formatVersion"] = json!(3);
    fs::write(&path, serde_json::to_string_pretty(&json).unwrap()).unwrap();
    let board = f.store.board(&f.project).unwrap();
    assert!(board.tasks.is_empty());
    assert!(board.problems.iter().any(|p| p.field == "formatVersion"));
}

#[test]
fn a_backup_folder_in_epics_does_not_stop_the_migration() {
    let f = fx();
    let l = legacy_project(&f);
    // A copy of an old AI-draft epic that is not a valid epic id stays as it is.
    let backup = f.dir.join("epics/OLD.bak");
    fs::create_dir_all(&backup).unwrap();
    fs::copy(f.dir.join("epics/OLD/epic.json"), backup.join("epic.json")).unwrap();
    let kept = fs::read(backup.join("epic.json")).unwrap();

    f.store
        .add_history(&f.project, l.ordinary_todo, Some("note"), now())
        .unwrap();

    assert!(marker(&f).exists(), "the migration ran");
    assert_eq!(f.lane(l.todo), Column::Backlog);
    assert_eq!(fs::read(backup.join("epic.json")).unwrap(), kept);
}

#[test]
fn an_old_client_handing_a_plan_back_to_the_ai_never_leaves_it_ready_in_todo() {
    let f = fx();
    let plan = f.plan("Plan");
    let todo = f.human_task("Card");
    for id in [plan, todo] {
        f.store
            .set_draft(&f.project, id, Some(Draft::Human), false, now())
            .unwrap();
    }
    // A plan from before the Backlog that a person was editing, still in Todo.
    let refused = f
        .store
        .edit_draft_task_to(
            &f.project,
            todo,
            Some("New"),
            None,
            DraftSave {
                target: Some(None),
                legacy_ai: true,
            },
            now(),
        )
        .unwrap_err();
    assert_eq!(refused.code(), "invalid_value");
    let task = f.store.task(&f.project, todo).unwrap();
    assert_eq!(task.task_status, Column::Todo);
    assert_eq!(task.draft, Some(Draft::Human), "nothing was saved");

    // In the Backlog the same save releases the edit lock and does not move the card.
    let saved = f
        .store
        .edit_draft_task_to(
            &f.project,
            plan,
            Some("New"),
            None,
            DraftSave {
                target: Some(None),
                legacy_ai: true,
            },
            now(),
        )
        .unwrap();
    assert_eq!(saved.value.task_status, Column::Backlog);
    assert_eq!(saved.value.draft, None);
}

#[test]
fn an_old_client_releasing_the_draft_of_a_plan_with_ai_never_leaves_it_ready_in_todo() {
    let f = fx();
    let plan = f.plan("Plan");
    let todo = f.human_task("Card");
    for id in [plan, todo] {
        f.store
            .set_draft(&f.project, id, Some(Draft::Human), false, now())
            .unwrap();
    }
    let refused = f
        .store
        .set_draft_from(&f.project, todo, None, false, true, now())
        .unwrap_err();
    assert_eq!(refused.code(), "invalid_value");
    let task = f.store.task(&f.project, todo).unwrap();
    assert_eq!(task.task_status, Column::Todo);
    assert_eq!(task.draft, Some(Draft::Human), "nothing was written");

    let released = f
        .store
        .set_draft_from(&f.project, plan, None, false, true, now())
        .unwrap();
    assert_eq!(released.value.task_status, Column::Backlog);
    assert_eq!(released.value.draft, None);
}

fn png() -> Vec<u8> {
    vec![
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240,
        31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]
}

const IMAGE_ID: &str = "00000000000000000000000000000001";

/// A task with one image, left as a person's draft.
fn draft_with_image(f: &Fx) -> (i64, AttachmentOwner) {
    let id = f.human_task("Card");
    let owner = AttachmentOwner::Task(id);
    f.store
        .set_draft(&f.project, id, Some(Draft::Human), false, now())
        .unwrap();
    f.store
        .add_attachment_for_user(
            &f.project,
            &owner,
            AttachmentInput {
                id: IMAGE_ID.into(),
                name: "a.png".into(),
                bytes: png(),
            },
            now(),
        )
        .unwrap();
    (id, owner)
}

fn removing_the_image() -> ImageChanges {
    ImageChanges {
        removed: vec![IMAGE_ID.into()],
        added: Vec::new(),
    }
}

#[test]
fn a_refused_legacy_release_keeps_the_images() {
    let f = fx();
    let (todo, owner) = draft_with_image(&f);
    let refused = f
        .store
        .edit_draft_task_with_images(
            &f.project,
            todo,
            (None, Some("new text")),
            DraftSave {
                target: Some(None),
                legacy_ai: true,
            },
            removing_the_image(),
            now(),
        )
        .unwrap_err();
    assert_eq!(refused.code(), "invalid_value");
    f.store
        .attachment_path(&f.project, &owner, IMAGE_ID)
        .unwrap();
}

#[test]
fn a_save_refused_as_not_a_draft_keeps_the_images() {
    let f = fx();
    let (id, owner) = draft_with_image(&f);
    f.store
        .set_draft(&f.project, id, None, false, now())
        .unwrap();
    let refused = f
        .store
        .edit_draft_task_with_images(
            &f.project,
            id,
            (None, None),
            DraftSave::default(),
            removing_the_image(),
            now(),
        )
        .unwrap_err();
    assert_eq!(refused.code(), "task_not_draft");
    f.store
        .attachment_path(&f.project, &owner, IMAGE_ID)
        .unwrap();
}

#[test]
fn a_draft_save_removes_the_images_and_saves_the_text_together() {
    let f = fx();
    let (id, owner) = draft_with_image(&f);
    let saved = f
        .store
        .edit_draft_task_with_images(
            &f.project,
            id,
            (None, Some("new text")),
            DraftSave::default(),
            removing_the_image(),
            now(),
        )
        .unwrap();
    assert!(saved.changed);
    assert_eq!(
        f.store
            .attachment_path(&f.project, &owner, IMAGE_ID)
            .unwrap_err()
            .code(),
        "attachment_not_found"
    );
}

const OTHER_ID: &str = "00000000000000000000000000000002";
const THIRD_ID: &str = "00000000000000000000000000000003";

fn new_image(id: &str) -> AttachmentInput {
    AttachmentInput {
        id: id.into(),
        name: "b.png".into(),
        bytes: png(),
    }
}

#[test]
fn a_save_whose_addition_collides_keeps_every_image_and_the_text() {
    let f = fx();
    let (id, owner) = draft_with_image(&f);
    f.store
        .add_attachment_for_user(&f.project, &owner, new_image(OTHER_ID), now())
        .unwrap();
    let before = f.store.task(&f.project, id).unwrap().description;
    let refused = f
        .store
        .edit_draft_task_with_images(
            &f.project,
            id,
            (None, Some("new text")),
            DraftSave::default(),
            ImageChanges {
                removed: vec![IMAGE_ID.into()],
                added: vec![new_image(OTHER_ID)],
            },
            now(),
        )
        .unwrap_err();
    assert_eq!(refused.code(), "invalid_value");
    for kept in [IMAGE_ID, OTHER_ID] {
        f.store.attachment_path(&f.project, &owner, kept).unwrap();
    }
    assert_eq!(f.store.task(&f.project, id).unwrap().description, before);
}

#[test]
fn a_save_that_reuses_a_removed_id_is_refused_and_keeps_the_image() {
    let f = fx();
    let (id, owner) = draft_with_image(&f);
    let refused = f
        .store
        .edit_draft_task_with_images(
            &f.project,
            id,
            (None, None),
            DraftSave::default(),
            ImageChanges {
                removed: vec![IMAGE_ID.into()],
                added: vec![new_image(IMAGE_ID)],
            },
            now(),
        )
        .unwrap_err();
    assert_eq!(refused.code(), "invalid_value");
    f.store
        .attachment_path(&f.project, &owner, IMAGE_ID)
        .unwrap();
}

#[test]
fn a_draft_save_swaps_images_and_saves_the_text() {
    let f = fx();
    let (id, owner) = draft_with_image(&f);
    let saved = f
        .store
        .edit_draft_task_with_images(
            &f.project,
            id,
            (None, Some("new text")),
            DraftSave::default(),
            ImageChanges {
                removed: vec![IMAGE_ID.into()],
                added: vec![new_image(THIRD_ID)],
            },
            now(),
        )
        .unwrap();
    assert!(saved.changed);
    assert!(saved.value.description.contains("new text"));
    f.store
        .attachment_path(&f.project, &owner, THIRD_ID)
        .unwrap();
    assert_eq!(
        f.store
            .attachment_path(&f.project, &owner, IMAGE_ID)
            .unwrap_err()
            .code(),
        "attachment_not_found"
    );
}
