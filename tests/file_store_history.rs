use agent_board::domain::{Actor, Column, RunState};
use agent_board::file_store::{
    history::{ParseMode, compose_task, parse_task},
    model::{HistoryRecord, TaskFile, TaskMetadata},
};

fn created() -> HistoryRecord {
    serde_json::from_value(serde_json::json!({"id":"11111111111111111111111111111111","kind":"created","actor":"ai","reason":null,"fromCardStatus":null,"toCardStatus":"todo","fromAgentStatus":null,"toAgentStatus":"idle","requestId":null,"at":"2026-10-14T00:00:00Z"})).unwrap()
}

#[test]
fn roundtrip_keeps_body_acceptance_unknown_keys_and_events() {
    let original = "---\nacceptance: [{id: AC-1, text: Keep this, done: false}]\ncustom: {nested: [one, two]}\n---\n\nBody\n";
    let text = compose_task(original, "Body\n", None, &[created()]).unwrap();
    let parsed = parse_task(&text, ParseMode::Stored);
    assert!(parsed.defects().is_empty());
    assert_eq!(parsed.body, "Body\n");
    assert_eq!(parsed.history, vec![created()]);
    assert_eq!(parsed.acceptance.len(), 1);
    assert!(text.contains("custom:"));
    assert_eq!(
        compose_task(&text, &parsed.body, None, &parsed.history).unwrap(),
        text
    );
}

#[test]
fn invalid_history_keeps_valid_acceptance_and_body() {
    let text =
        "---\nacceptance: [{id: AC-1, text: Keep this, done: true}]\nhistory: null\n---\n\nBody";
    let parsed = parse_task(text, ParseMode::Stored);
    assert!(parsed.acceptance_defects.is_empty());
    assert_eq!(parsed.acceptance.len(), 1);
    assert_eq!(parsed.body, "Body");
    assert!(parsed.history.is_empty());
    assert_eq!(parsed.history_defects[0].field, "history");
}

#[test]
fn invalid_acceptance_keeps_valid_history() {
    let text = compose_task(
        "---\nacceptance: false\n---\n\nBody",
        "Body",
        None,
        &[created()],
    )
    .unwrap();
    let parsed = parse_task(&text, ParseMode::Stored);
    assert!(parsed.history_defects.is_empty());
    assert!(!parsed.acceptance_defects.is_empty());
    assert_eq!(parsed.history, vec![created()]);
}

#[test]
fn stored_history_requires_created_unique_ids_and_typed_fields() {
    assert_eq!(
        parse_task("Body", ParseMode::Stored).history_defects[0].field,
        "history"
    );
    assert!(
        !parse_task("---\nhistory: []\n---", ParseMode::Stored)
            .history_defects
            .is_empty()
    );
    assert!(
        compose_task("", "", None, &[created(), created()])
            .unwrap_err()
            .field
            .ends_with(".id")
    );
    let mut event = created();
    event.kind = agent_board::file_store::model::HistoryKind::Lane;
    event.actor = Actor::Human;
    event.from_card_status = Some(Column::Todo);
    event.to_card_status = Column::Doing;
    event.from_agent_status = Some(RunState::Idle);
    event.reason = Some("Start".into());
    assert!(compose_task("", "", None, &[event]).is_err());
    let text = compose_task("", "", None, &[created()])
        .unwrap()
        .replace("actor: ai", "actor: []");
    assert_eq!(
        parse_task(&text, ParseMode::Stored).history_defects[0].field,
        "history[0].actor"
    );
}

#[test]
fn creation_input_accepts_only_absent_or_empty_history() {
    for text in ["Body", "---\nhistory: []\n---\n\nBody"] {
        assert!(parse_task(text, ParseMode::NewInput).defects().is_empty());
    }
    let text = compose_task("", "Body", None, &[created()]).unwrap();
    assert!(
        !parse_task(&text, ParseMode::NewInput)
            .history_defects
            .is_empty()
    );
    assert!(
        !parse_task("---\nhistory: null\n---", ParseMode::NewInput)
            .history_defects
            .is_empty()
    );
}

#[test]
fn malformed_yaml_and_unclosed_frontmatter_keep_body_and_never_compose() {
    for text in ["---\nhistory: [\n---\n\nBody", "---\nhistory: ["] {
        let parsed = parse_task(text, ParseMode::Stored);
        assert!(!parsed.frontmatter_defects.is_empty());
        assert!(!parsed.defects().is_empty());
        assert!(compose_task(text, "Body", None, &[created()]).is_err());
    }
}

#[test]
fn metadata_serialization_does_not_contain_history_and_join_is_lossless() {
    let task: TaskFile = serde_json::from_value(serde_json::json!({"formatVersion":2,"id":1,"title":"Test","assignee":"ai","epicId":null,"cardStatus":"todo","agentStatus":"idle","position":1,"isDraft":false,"archivedAt":null,"pendingRequestId":null,"createdAt":"2026-10-14T00:00:00Z","updatedAt":"2026-10-14T00:00:00Z","agentStatusChangedAt":"2026-10-14T00:00:00Z","attachments":[],"evidence":[],"history":[created()]})).unwrap();
    let metadata = TaskMetadata::from(&task);
    let value = serde_json::to_value(&metadata).unwrap();
    assert_eq!(value["formatVersion"], 2);
    assert!(value.get("history").is_none());
    let mut expected = task.clone();
    expected.format_version = 2;
    assert_eq!(metadata.with_history(task.history), expected);
}

#[test]
fn invalid_history_field_types_and_timestamps_have_precise_paths() {
    let original = compose_task("", "Body", None, &[created()]).unwrap();
    for (before, after, field) in [
        ("kind: created", "kind: unknown", "kind"),
        (
            "toCardStatus: todo",
            "toCardStatus: unknown",
            "toCardStatus",
        ),
        (
            "at: 2026-10-14T00:00:00Z",
            "at: 2026-10-14T00:00:00+00:00",
            "at",
        ),
        ("reason: null", "reason: []", "reason"),
    ] {
        let text = original.replace(before, after);
        assert_ne!(text, original, "{before}");
        let parsed = parse_task(&text, ParseMode::Stored);
        assert!(
            parsed
                .history_defects
                .iter()
                .any(|d| d.field == format!("history[0].{field}")),
            "{:?}",
            parsed.history_defects
        );
    }
}

#[test]
fn defects_keep_original_indices_after_an_unreadable_event() {
    let event = serde_yaml_ng::to_value(created()).unwrap();
    let mut invalid = event.clone();
    invalid
        .as_mapping_mut()
        .unwrap()
        .insert("actor".into(), serde_yaml_ng::Value::Sequence(vec![]));
    let history = serde_yaml_ng::to_string(&vec![invalid, event.clone(), event]).unwrap();
    let text = format!(
        "---\nhistory:\n{}---\n\nBody",
        history
            .lines()
            .map(|line| format!("  {line}\n"))
            .collect::<String>()
    );
    let parsed = parse_task(&text, ParseMode::Stored);
    assert!(
        parsed
            .history_defects
            .iter()
            .any(|d| d.field == "history[0].actor")
    );
    assert!(
        parsed
            .history_defects
            .iter()
            .any(|d| d.field == "history[2].id")
    );
}
