//! Editing a TASK replaces its text while keeping the latest Markdown history.

mod common;

use std::str::FromStr;

use agent_board::domain::{Actor, ChangeContext, Column, ProjectId};
use agent_board::file_store::{FileStore, TaskTextParts, frontmatter::AcceptanceItem};
use chrono::{TimeZone, Utc};
use common::{agboard, demo_project, json_ok};

fn project_id(home: &std::path::Path) -> ProjectId {
    ProjectId::from_str(
        json_ok(home, &["project", "ls", "--json"])["projects"][0]["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap()
}

#[test]
fn body_only_draft_edit_uses_latest_markdown_acceptance_and_history() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let project = project_id(home.path());
    let files = FileStore::open(&home.path().join("shared"));
    let now = Utc.with_ymd_and_hms(2026, 10, 14, 12, 0, 0).unwrap();

    files
        .edit_card_parts(
            &project,
            1,
            None,
            TaskTextParts {
                body: None,
                acceptance: Some(&[AcceptanceItem {
                    id: "AC-1".into(),
                    text: "Keep the latest condition".into(),
                    done: false,
                }]),
            },
            now,
        )
        .unwrap();
    files.set_draft(&project, 1, true, now).unwrap();
    let moved = files
        .move_work_card_for_user(
            &project,
            1,
            Column::Todo,
            ChangeContext {
                actor: Actor::Human,
                reason: "Reprioritized during editing".into(),
            },
            now + chrono::Duration::seconds(1),
        )
        .unwrap();
    let status_history = moved.value.history.clone();

    let edited = files
        .edit_draft_card_parts(
            &project,
            1,
            None,
            TaskTextParts {
                body: Some("Edited body while the draft was open.\n"),
                acceptance: None,
            },
            false,
            now + chrono::Duration::seconds(2),
        )
        .unwrap();
    assert_eq!(edited.value.body, "Edited body while the draft was open.\n");
    assert_eq!(edited.value.card_status, Column::Todo);
    assert_eq!(edited.value.acceptance[0].text, "Keep the latest condition");
    assert_eq!(edited.value.history, status_history);
}

#[test]
fn cli_file_replacement_without_history_keeps_current_history() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let initial = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    let original = initial["card"]["description"].as_str().unwrap();
    let replacement = home.path().join("replacement.md");
    std::fs::write(&replacement, "Edited by CLI\n").unwrap();

    let (_, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "1",
            "todo",
            "--actor",
            "human",
            "--reason",
            "Changed priority",
        ],
    );
    assert!(err.is_empty(), "{err}");
    let before_edit = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    let history = before_edit["card"]["history"].clone();
    let path = replacement.to_str().unwrap();
    let (code, _, error) = agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--desc-file", path],
    );
    assert_eq!(code, 0, "{error}");

    let after = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    assert_eq!(after["card"]["history"], history);
    assert_eq!(after["card"]["body"], "Edited by CLI");

    let (_, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "1",
            "doing",
            "--actor",
            "human",
            "--reason",
            "Moved after the editor loaded",
        ],
    );
    assert!(err.is_empty(), "{err}");
    let with_new_status = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    let latest_history = with_new_status["card"]["history"].clone();
    let stale_file = home.path().join("stale.md");
    std::fs::write(&stale_file, original).unwrap();
    let stale_path = stale_file.to_str().unwrap();
    let (code, _, error) = agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--desc-file", stale_path],
    );
    assert_eq!(code, 0, "{error}");
    let after_stale_edit = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    assert_eq!(after_stale_edit["card"]["history"], latest_history);
}

#[test]
fn cli_edit_refuses_invalid_history_without_rewriting_task_markdown() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let shared = json_ok(home.path(), &["--project", "Demo", "workspace", "--json"]);
    let md = std::path::Path::new(shared["tasks"].as_str().unwrap()).join("1/TASK.md");
    let original = std::fs::read_to_string(&md).unwrap();
    let invalid = original.replace(
        "reason: Created card in Todo with agent idle.",
        "reason: []",
    );
    assert_ne!(invalid, original, "fixture must contain a creation reason");
    std::fs::write(&md, &invalid).unwrap();
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--json",
            "--project",
            "Demo",
            "edit",
            "1",
            "--desc",
            "replacement",
        ],
    );
    assert_ne!(code, 0);
    assert!(err.contains("file_invalid"), "{err}");
    assert_eq!(std::fs::read_to_string(md).unwrap(), invalid);
}

#[test]
fn rejected_finalize_keeps_the_draft_body_and_history_unchanged() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let project = project_id(home.path());
    let files = FileStore::open(&home.path().join("shared"));
    let now = Utc.with_ymd_and_hms(2026, 10, 14, 13, 0, 0).unwrap();
    files.set_draft(&project, 1, true, now).unwrap();
    let before = files.card(&project, 1).unwrap();
    let invalid_acceptance = [
        AcceptanceItem {
            id: "AC-1".into(),
            text: "First".into(),
            done: false,
        },
        AcceptanceItem {
            id: "AC-1".into(),
            text: "Duplicate".into(),
            done: false,
        },
    ];

    let error = files
        .edit_draft_card_parts(
            &project,
            1,
            None,
            TaskTextParts {
                body: Some("This must not be saved.\n"),
                acceptance: Some(&invalid_acceptance),
            },
            true,
            now + chrono::Duration::seconds(1),
        )
        .unwrap_err();
    assert!(
        matches!(error, agent_board::error::AgboardError::FileInvalid { .. }),
        "{error:?}"
    );
    let after = files.card(&project, 1).unwrap();
    assert!(after.is_draft);
    assert_eq!(after.body, before.body);
    assert_eq!(after.history, before.history);
}
