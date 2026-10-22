//! The data layer's wire contract against the golden examples in `tests/fixtures/data-layer/`.
//! A valid example must restore into the Rust types and serialize back to the same JSON; every
//! file in `invalid/` must be refused. The TypeScript contract reads the same files.

use std::fs;
use std::path::{Path, PathBuf};

use agent_board::server::contracts::detail::parse_sections;
use agent_board::server::contracts::{Changed, DetailEvent, Section, StreamValidator, Summary};
use serde_json::Value;

fn dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/data-layer")
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn invalid(prefix: &str) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir().join("invalid"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(prefix)
        })
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no invalid examples named {prefix}*");
    files
}

/// Parses every line, checks the order, and returns the events. An error is the refusal.
fn read_stream(text: &str) -> Result<Vec<DetailEvent>, String> {
    let mut validator = StreamValidator::new();
    let mut events = Vec::new();
    for line in text.lines() {
        let event: DetailEvent = serde_json::from_str(line).map_err(|e| e.to_string())?;
        validator.accept(&event).map_err(|e| e.to_string())?;
        events.push(event);
    }
    validator.finish().map_err(|e| e.to_string())?;
    Ok(events)
}

fn read_changed(text: &str) -> Result<Changed, String> {
    let changed: Changed = serde_json::from_str(text).map_err(|e| e.to_string())?;
    match changed.problem() {
        Some(problem) => Err(problem),
        None => Ok(changed),
    }
}

#[test]
fn contracts_summary_example_round_trips() {
    let text = read(&dir().join("summary.json"));
    let original: Value = serde_json::from_str(&text).unwrap();
    let summary: Summary = serde_json::from_str(&text).unwrap();
    assert_eq!(serde_json::to_value(&summary).unwrap(), original);
    assert_eq!(summary.tasks.len(), 2);
    assert!(summary.tasks[1].onboarding_sample.is_some());
    assert!(summary.tasks[0].onboarding_sample.is_none());
}

#[test]
fn contracts_summary_carries_no_full_text() {
    let text = read(&dir().join("summary.json"));
    let value: Value = serde_json::from_str(&text).unwrap();
    for task in value["tasks"].as_array().unwrap() {
        for key in ["description", "body", "history", "attachments"] {
            assert!(task.get(key).is_none(), "{key}");
        }
        assert!(task["acceptance"]["done"].is_u64());
        assert!(task["acceptance"].get("text").is_none());
        assert!(task["detailVersions"]["document"].is_string());
        assert!(task["detailVersions"]["history"].is_string());
    }
    for epic in value["epics"].as_array().unwrap() {
        assert!(epic.get("document").is_none() && epic.get("body").is_none());
        assert!(epic["detailVersions"]["document"].is_string());
    }
}

#[test]
fn contracts_summary_refuses_invalid_examples() {
    for path in invalid("summary-") {
        assert!(
            serde_json::from_str::<Summary>(&read(&path)).is_err(),
            "{} was accepted",
            path.display()
        );
    }
}

#[test]
fn contracts_detail_examples_round_trip_in_order() {
    for name in [
        "task-detail.ndjson",
        "task-detail-history.ndjson",
        "epic-detail.ndjson",
    ] {
        let text = read(&dir().join(name));
        let events = read_stream(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(events.len(), lines.len(), "{name}");
        for (event, line) in events.iter().zip(&lines) {
            let original: Value = serde_json::from_str(line).unwrap();
            assert_eq!(
                serde_json::to_value(event).unwrap(),
                original,
                "{name}: {line}"
            );
        }
        let rebuilt: String = events.iter().map(DetailEvent::to_line).collect();
        assert_eq!(rebuilt, text, "{name}");
    }
}

#[test]
fn contracts_detail_covers_every_event_type() {
    let events = read_stream(&read(&dir().join("task-detail.ndjson"))).unwrap();
    let mut seen: Vec<String> = events
        .iter()
        .map(|e| {
            serde_json::to_value(e).unwrap()["type"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    seen.sort();
    seen.dedup();
    assert_eq!(
        seen,
        [
            "acceptance",
            "block",
            "complete",
            "history-item",
            "section-end",
            "section-start",
            "start"
        ]
    );
}

#[test]
fn contracts_detail_refuses_invalid_examples() {
    for path in invalid("detail-") {
        assert!(
            read_stream(&read(&path)).is_err(),
            "{} was accepted",
            path.display()
        );
    }
}

#[test]
fn contracts_changed_example_round_trips() {
    let text = read(&dir().join("changed.json"));
    let original: Value = serde_json::from_str(&text).unwrap();
    let changed = read_changed(&text).unwrap();
    assert_eq!(serde_json::to_value(&changed).unwrap(), original);
    assert_eq!(changed.seq, 42);
    assert_eq!(changed.changes.len(), 4);
}

#[test]
fn contracts_changed_refuses_invalid_examples() {
    for path in invalid("changed-") {
        assert!(
            read_changed(&read(&path)).is_err(),
            "{} was accepted",
            path.display()
        );
    }
}

#[test]
fn contracts_sections_query_accepts_three_forms() {
    assert_eq!(
        parse_sections(None),
        Ok(vec![Section::Document, Section::History])
    );
    assert_eq!(
        parse_sections(Some("document")),
        Ok(vec![Section::Document])
    );
    assert_eq!(parse_sections(Some("history")), Ok(vec![Section::History]));
    assert_eq!(
        parse_sections(Some("document,history")),
        Ok(vec![Section::Document, Section::History])
    );
    for bad in [
        "",
        "body",
        "history,document",
        "document,",
        "document,document",
        "Document",
    ] {
        assert!(parse_sections(Some(bad)).is_err(), "{bad}");
    }
}
