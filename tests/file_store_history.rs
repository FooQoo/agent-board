use agent_board::file_store::{
    history::{ParseMode, compose_task, parse_task},
    model::{HistoryRecord, TaskFile, TaskMetadata},
};

fn created() -> HistoryRecord {
    serde_json::from_value(serde_json::json!({"at":"2026-10-14T00:00:00Z","reason":"Created task in Todo with agent idle."})).unwrap()
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
fn stored_history_requires_only_valid_at_and_nonblank_reason() {
    assert_eq!(
        parse_task("Body", ParseMode::Stored).history_defects[0].field,
        "history"
    );
    assert!(
        parse_task("---\nhistory: []\n---", ParseMode::Stored)
            .history_defects
            .is_empty()
    );
    assert!(compose_task("", "", None, &[created(), created()]).is_ok());
    let mut event = created();
    event.reason = "  ".into();
    assert!(compose_task("", "", None, &[event]).is_err());
    let text = compose_task("", "", None, &[created()])
        .unwrap()
        .replace("reason:", "actor: ai\n  reason:");
    assert!(
        parse_task(&text, ParseMode::Stored)
            .history_defects
            .iter()
            .any(|d| d.field == "history[0].actor")
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
    let task: TaskFile = serde_json::from_value(serde_json::json!({"formatVersion":1,"id":1,"title":"Test","assignee":"ai","epicId":null,"taskStatus":"todo","agentStatus":"idle","position":1,"isDraft":false,"archivedAt":null,"pendingRequestId":null,"pendingRequest":null,"requestAnswers":[],"createdAt":"2026-10-14T00:00:00Z","updatedAt":"2026-10-14T00:00:00Z","agentStatusChangedAt":"2026-10-14T00:00:00Z","taskStatusChangedAt":"2026-10-14T00:00:00Z","attachments":[],"evidence":[],"history":[created()]})).unwrap();
    let metadata = TaskMetadata::from(&task);
    let value = serde_json::to_value(&metadata).unwrap();
    assert_eq!(value["formatVersion"], 1);
    assert!(value.get("history").is_none());
    let mut expected = task.clone();
    expected.format_version = 1;
    assert_eq!(metadata.with_history(task.history), expected);
}

#[test]
fn invalid_history_field_types_and_timestamps_have_precise_paths() {
    let original = compose_task("", "Body", None, &[created()]).unwrap();
    for (before, after, field) in [
        (
            "reason: Created task in Todo with agent idle.",
            "reason: []",
            "reason",
        ),
        (
            "at: 2026-10-14T00:00:00Z",
            "at: 2026-10-14T00:00:00+00:00",
            "at",
        ),
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
        .insert("reason".into(), serde_yaml_ng::Value::Sequence(vec![]));
    let history = serde_yaml_ng::to_string(&vec![invalid, event.clone(), {
        let mut blank = event;
        blank
            .as_mapping_mut()
            .unwrap()
            .insert("reason".into(), " ".into());
        blank
    }])
    .unwrap();
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
            .any(|d| d.field == "history[0].reason")
    );
    assert!(
        parsed
            .history_defects
            .iter()
            .any(|d| d.field == "history[2].reason")
    );
}
