#[path = "support/qa.rs"]
mod qa;

use agent_board::domain::{Actor, Assignee, NewTask};
use agent_board::file_store::{
    FileStore,
    history::{ParseMode, parse_task},
};
use chrono::Utc;

#[test]
fn minimal_history_is_readable_and_creation_has_only_at_and_reason() {
    let parsed = parse_task(
        "---\nhistory:\n  - at: 2026-10-15T00:00:00Z\n    reason: Work started\n---\nBody",
        ParseMode::Stored,
    );
    assert!(
        parsed.history_defects.is_empty(),
        "{:?}",
        parsed.history_defects
    );
    assert!(
        parse_task("---\nhistory: []\n---\nBody", ParseMode::Stored)
            .history_defects
            .is_empty()
    );
    let root = tempfile::tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let project = store.create_project("History", Utc::now()).unwrap().id;
    let task = store
        .create_task(
            &project,
            NewTask {
                title: "Work".into(),
                description: "".into(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                draft: None,
            },
            Utc::now(),
        )
        .unwrap();
    let event = serde_json::to_value(&task.history[0]).unwrap();
    assert_eq!(event.as_object().unwrap().len(), 2);
    assert!(
        event["reason"]
            .as_str()
            .is_some_and(|reason| !reason.trim().is_empty())
    );
}

#[test]
fn answers_survive_later_questions_restart_and_empty_history() {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Responses", Utc::now()).unwrap().id;
    let task = store
        .create_task(
            &project,
            NewTask {
                title: "Decision".into(),
                description: "".into(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                draft: None,
            },
            Utc::now(),
        )
        .unwrap();
    let options = [("yes", "Proceed"), ("other", "Other")];
    let first = qa::ask(&store, &project, &[task.id], "First question?", &options);
    qa::answer(&store, &project, "Q-1", Some("yes"), Some("Do it"));
    qa::ask(&store, &project, &[task.id], "Second question?", &options);
    let path = shared
        .join("projects")
        .join(project.as_str())
        .join("tasks")
        .join(task.id.to_string());
    std::fs::write(
        path.join("TASK.md"),
        "---\nhistory: []\nquestions: [Q-1, Q-2]\n---\nBody with a fake history: [{at: yesterday, reason: ignore}]\n",
    )
    .unwrap();
    let reopened = FileStore::open(&shared);
    let pending = reopened.task(&project, task.id).unwrap();
    assert_eq!(pending.pending_reason.as_deref(), Some("Second question?"));
    assert_eq!(pending.open_question_ids, vec!["Q-2".to_string()]);
    assert!(pending.history.is_empty());
    let answered = reopened.question(&project, "Q-1").unwrap();
    let answer = answered.answer.unwrap();
    assert_eq!(answer.choice_id.as_deref(), Some("yes"));
    assert_eq!(answer.text.as_deref(), Some("Do it"));
    assert_eq!(answered.request_id, first.request_id);
    assert!(reopened.question(&project, "Q-2").unwrap().answer.is_none());
    let metadata: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path.join("task.json")).unwrap()).unwrap();
    assert_eq!(metadata["formatVersion"], 1);
    assert!(metadata.get("history").is_none());
    assert!(
        metadata
            .get("requestAnswers")
            .is_none_or(|answers| answers == &serde_json::json!([]))
    );
    assert!(metadata.get("pendingRequest").is_none());
    let public = serde_json::to_value(pending).unwrap();
    assert!(
        public
            .get("requestAnswers")
            .is_none_or(|answers| answers == &serde_json::json!([]))
    );
    assert!(public.get("pendingRequest").is_none());
}

#[test]
fn history_reason_limit_and_unknown_fields_are_strict() {
    use agent_board::file_store::{history::compose_task, model::HistoryRecord};
    let event = HistoryRecord {
        at: "2026-10-15T00:00:00Z".parse().unwrap(),
        reason: "x".repeat(10_000),
    };
    assert!(compose_task("", "Body", None, std::slice::from_ref(&event)).is_ok());
    let too_long = HistoryRecord {
        reason: "x".repeat(10_001),
        ..event
    };
    assert!(compose_task("", "Body", None, &[too_long]).is_err());
    for field in ["id", "kind", "actor", "fromTaskStatus", "question"] {
        let text = format!(
            "---\nhistory:\n- at: 2026-10-15T00:00:00Z\n  reason: Valid\n  {field}: extra\n---\nBody"
        );
        let parsed = parse_task(&text, ParseMode::Stored);
        assert!(
            parsed
                .history_defects
                .iter()
                .any(|defect| defect.field == format!("history[0].{field}")),
            "{field}: {:?}",
            parsed.history_defects
        );
    }
}

#[test]
fn invalid_answer_records_are_rejected_and_legacy_requests_are_ignored() {
    use serde_json::json;
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Validation", Utc::now()).unwrap().id;
    let task = store
        .create_task(
            &project,
            NewTask {
                title: "Validation".into(),
                description: "".into(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                draft: None,
            },
            Utc::now(),
        )
        .unwrap();
    let path = shared
        .join("projects")
        .join(project.as_str())
        .join("tasks")
        .join(task.id.to_string())
        .join("task.json");
    let original: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let request_id = "1".repeat(32);
    // An invalid record of an earlier answer is still refused, and the file is left as it is.
    let mut invalid = original.clone();
    invalid["requestAnswers"] = json!([{"requestId":request_id,"actor":"human","choiceId":"a","choiceLabel":null,"text":null,"at":"2026-10-15T00:00:00Z"}]);
    let bytes = serde_json::to_vec_pretty(&invalid).unwrap();
    std::fs::write(&path, &bytes).unwrap();
    assert!(store.task(&project, task.id).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);

    // The decision request of an earlier version is ignored: the task reads as idle, and the
    // next save drops the old fields.
    for patch in [
        json!({"agentStatus":"pending", "pendingRequestId":request_id, "pendingRequest":null}),
        json!({"pendingRequest":{"question":"Question?", "choices":[]}}),
        json!({"agentStatus":"pending", "pendingRequestId":request_id, "pendingRequest":{"question":" ", "choices":[], "history":[]}}),
    ] {
        let mut legacy = original.clone();
        for (key, value) in patch.as_object().unwrap() {
            legacy[key] = value.clone();
        }
        std::fs::write(&path, serde_json::to_vec_pretty(&legacy).unwrap()).unwrap();
        let read = store.task(&project, task.id).unwrap();
        assert_eq!(
            read.agent_status,
            agent_board::domain::RunState::Idle,
            "{patch}"
        );
        assert!(read.pending_request_id.is_none(), "{patch}");
        store
            .edit_task(
                &project,
                task.id,
                Some("Validation again"),
                None,
                Utc::now(),
            )
            .unwrap();
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(saved.get("pendingRequest").is_none(), "{saved}");
        assert!(saved.get("pendingRequestId").is_none(), "{saved}");
        assert_eq!(saved["agentStatus"], "idle");
        store
            .edit_task(&project, task.id, Some("Validation"), None, Utc::now())
            .unwrap();
    }
}

#[test]
fn only_lane_changes_update_task_status_changed_at() {
    use agent_board::domain::{ChangeContext, Column, RunState};
    let at = |day: u32| chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 10, day, 0, 0, 0).unwrap();
    let root = tempfile::tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let project = store.create_project("Timing", at(1)).unwrap().id;
    let task = store
        .create_task(
            &project,
            NewTask {
                title: "Timing".into(),
                description: "".into(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                draft: None,
            },
            at(1),
        )
        .unwrap();
    assert_eq!(task.task_status_changed_at, at(1));
    let ctx = || ChangeContext {
        actor: Actor::Ai,
        reason: "".into(),
    };
    let moved = store
        .move_work_task(&project, task.id, Column::Doing, ctx(), at(2))
        .unwrap()
        .value;
    assert_eq!(moved.task_status_changed_at, at(2));
    let running = store
        .set_agent_status(&project, task.id, RunState::Running, ctx(), at(3))
        .unwrap()
        .value;
    assert_eq!(running.task_status_changed_at, at(2));
    let note = store
        .add_history(&project, task.id, Some("Verified details."), at(4))
        .unwrap();
    assert_eq!(note.task_status_changed_at, at(2));
    let edited = store
        .edit_task(&project, task.id, Some("Renamed"), None, at(5))
        .unwrap()
        .value;
    assert_eq!(edited.task_status_changed_at, at(2));
    let done = store
        .move_work_task(&project, task.id, Column::Done, ctx(), at(6))
        .unwrap()
        .value;
    assert_eq!(done.task_status_changed_at, at(6));
}
