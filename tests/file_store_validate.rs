//! Shape checks for shared files: the TASK.md headings and completion
//! conditions, the answer inputs, and the formatVersion gate.

use agent_board::error::AgboardError;
use agent_board::file_store::model::Choice;
use agent_board::file_store::validate::{
    check_format_version, check_task_body, ensure_task_body, normalize_answer_text,
    normalize_choices, normalize_question, task_template,
};

fn fields(text: &str) -> Vec<String> {
    check_task_body(text).into_iter().map(|d| d.field).collect()
}

fn valid_body() -> String {
    "## Work\n\nDo the work.\n\n## Completion conditions\n\n- [ ] AC-1. The thing works.\n  - Result: Not verified\n  - Evidence: Steps\n  - Coordinator check: Not checked\n\n## Execution log\n\n".to_string()
}

/// The same body with the Japanese headings and labels of earlier files.
fn japanese_body() -> String {
    "## 作業内容\n\nDo the work.\n\n## 完了条件と確認結果\n\n- [ ] AC-1. The thing works.\n  - 確認結果: 未確認\n  - 根拠: 手順\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n".to_string()
}

fn choice(id: &str, label: &str) -> Choice {
    Choice {
        id: id.into(),
        label: label.into(),
    }
}

#[test]
fn the_template_has_the_three_required_headings_and_no_defect() {
    let template = task_template();
    assert!(template.contains("## Work"));
    assert!(template.contains("## Completion conditions"));
    assert!(template.contains("## Execution log"));
    assert!(check_task_body(&template).is_empty(), "{template}");
}

#[test]
fn the_japanese_headings_and_labels_of_earlier_files_are_accepted() {
    assert!(check_task_body(&japanese_body()).is_empty());
    let mixed = valid_body()
        .replace("## Work", "## 作業内容")
        .replace("  - Evidence: Steps", "  - 根拠: 手順");
    assert!(check_task_body(&mixed).is_empty(), "{mixed}");
    let missing = japanese_body().replace("  - 根拠: 手順\n", "");
    assert_eq!(fields(&missing), vec!["AC-1"]);
}

#[test]
fn a_missing_required_heading_is_reported_by_its_name() {
    let body = valid_body().replace("## Execution log", "## Log");
    assert_eq!(fields(&body), vec!["## Execution log"]);
}

#[test]
fn a_heading_inside_a_code_block_does_not_count() {
    let body = valid_body().replace("Do the work.", "```\n## Work\n```");
    let body = body.replacen("## Work", "## Other", 1);
    assert_eq!(fields(&body), vec!["## Work"]);
}

#[test]
fn a_completion_condition_needs_all_three_lines_under_it() {
    let body = valid_body().replace("  - Evidence: Steps\n", "");
    assert_eq!(fields(&body), vec!["AC-1"]);
}

#[test]
fn a_checked_condition_is_accepted_and_a_condition_without_an_id_is_not() {
    let checked = valid_body().replace("- [ ] AC-1.", "- [x] AC-1.");
    assert!(check_task_body(&checked).is_empty());
    let no_id = valid_body().replace("- [ ] AC-1.", "- [ ] The thing works.");
    assert_eq!(fields(&no_id).len(), 1);
}

#[test]
fn crlf_line_endings_are_judged_like_lf() {
    let body = valid_body().replace('\n', "\r\n");
    assert!(check_task_body(&body).is_empty());
}

#[test]
fn ensure_task_body_names_the_file_and_the_item() {
    let body = valid_body().replace("## Execution log", "## Log");
    let err = ensure_task_body(&body, "projects/p/tasks/1/TASK.md").unwrap_err();
    match err {
        AgboardError::FileInvalid { file, field, .. } => {
            assert_eq!(file, "projects/p/tasks/1/TASK.md");
            assert_eq!(field, "## Execution log");
        }
        other => panic!("unexpected error: {other:?}"),
    }
    assert!(ensure_task_body(&valid_body(), "x").is_ok());
}

#[test]
fn choices_are_limited_to_ten_unique_ascii_ids_with_short_labels() {
    let ten: Vec<Choice> = (0..10).map(|i| choice(&format!("c{i}"), "Label")).collect();
    assert_eq!(normalize_choices(ten).unwrap().len(), 10);

    let eleven: Vec<Choice> = (0..11).map(|i| choice(&format!("c{i}"), "Label")).collect();
    assert!(matches!(
        normalize_choices(eleven),
        Err(AgboardError::InvalidValue { .. })
    ));
    for bad in [
        vec![choice("a", "x"), choice("a", "y")],
        vec![choice("a b", "x")],
        vec![choice("", "x")],
        vec![choice("é", "x")],
        vec![choice(&"a".repeat(65), "x")],
        vec![choice("a", "")],
        vec![choice("a", &"x".repeat(201))],
    ] {
        assert!(
            matches!(
                normalize_choices(bad.clone()),
                Err(AgboardError::InvalidValue { .. })
            ),
            "{bad:?}"
        );
    }
    let trimmed = normalize_choices(vec![choice("ok-1_x", "  Proceed  ")]).unwrap();
    assert_eq!(trimmed[0].label, "Proceed");
}

#[test]
fn a_question_is_one_to_two_thousand_characters_after_trimming() {
    assert_eq!(normalize_question("  a \r\n b ").unwrap(), "a \n b");
    assert!(normalize_question("   ").is_err());
    assert!(normalize_question(&"q".repeat(2_000)).is_ok());
    assert!(normalize_question(&"q".repeat(2_001)).is_err());
}

#[test]
fn an_answer_text_that_is_blank_counts_as_no_text() {
    assert_eq!(normalize_answer_text("   ").unwrap(), None);
    assert_eq!(
        normalize_answer_text(" use B \r\n").unwrap(),
        Some("use B".into())
    );
    assert!(normalize_answer_text(&"x".repeat(2_001)).is_err());
}

#[test]
fn only_format_version_one_passes_and_nothing_is_converted() {
    let ok = serde_json::json!({"formatVersion": 1});
    assert!(check_format_version(&ok, "project.json").is_ok());

    let future = serde_json::json!({"formatVersion": 2});
    assert!(matches!(
        check_format_version(&future, "project.json"),
        Err(AgboardError::FormatUnsupported { .. })
    ));
    let missing = serde_json::json!({"id": "x"});
    assert!(matches!(
        check_format_version(&missing, "project.json"),
        Err(AgboardError::FileInvalid { .. })
    ));
}
