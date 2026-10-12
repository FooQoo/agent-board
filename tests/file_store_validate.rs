//! Shape checks for shared files: the TASK.md frontmatter and its acceptance
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
    "---\nacceptance:\n  - id: AC-1\n    text: The thing works.\n    done: false\n---\n\nDo the work.\n".to_string()
}

fn choice(id: &str, label: &str) -> Choice {
    Choice {
        id: id.into(),
        label: label.into(),
    }
}

#[test]
fn the_template_is_an_empty_acceptance_list_and_no_defect() {
    let template = task_template();
    assert_eq!(template, "---\nacceptance: []\n---\n\n");
    assert!(check_task_body(&template).is_empty(), "{template}");
}

#[test]
fn the_japanese_headings_of_earlier_files_are_accepted_without_checks() {
    let body =
        "## 作業内容\n\n作業。\n\n## 完了条件と確認結果\n\n- [ ] AC-1. 旧形式\n\n## 実行記録\n\n";
    assert!(check_task_body(body).is_empty());
    assert!(check_task_body("just text").is_empty());
}

#[test]
fn a_file_with_no_required_headings_is_accepted_when_its_frontmatter_is_valid() {
    assert!(check_task_body(&valid_body()).is_empty());
    assert!(check_task_body("---\nacceptance: []\n---\n\n# anything\n").is_empty());
}

#[test]
fn a_frontmatter_defect_is_reported_by_its_field() {
    let body = valid_body().replace("done: false", "done: \"no\"");
    assert_eq!(fields(&body), vec!["acceptance[0].done"]);
}

#[test]
fn a_frontmatter_that_is_not_closed_is_reported_as_frontmatter() {
    let body = "---\nacceptance: []\n\nDo the work.\n";
    assert_eq!(fields(body), vec!["frontmatter"]);
}

#[test]
fn a_condition_id_must_be_ac_and_a_number() {
    let body = valid_body().replace("id: AC-1", "id: 1");
    assert_eq!(fields(&body), vec!["acceptance[0].id"]);
}

#[test]
fn crlf_line_endings_are_judged_like_lf() {
    let body = valid_body().replace('\n', "\r\n");
    assert!(check_task_body(&body).is_empty());
}

#[test]
fn ensure_task_body_names_the_file_and_the_item() {
    let body = valid_body().replace("done: false", "done: 1");
    let err = ensure_task_body(&body, "projects/p/tasks/1/TASK.md").unwrap_err();
    match err {
        AgboardError::FileInvalid { file, field, .. } => {
            assert_eq!(file, "projects/p/tasks/1/TASK.md");
            assert_eq!(field, "acceptance[0].done");
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
