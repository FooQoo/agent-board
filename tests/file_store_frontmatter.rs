//! The frontmatter of TASK.md and PLAN.md: the acceptance conditions it holds,
//! the body it leaves, and the defects that make the conditions unreadable.

use agent_board::file_store::frontmatter::{AcceptanceItem, compose, parse};

fn item(id: &str, text: &str, done: bool) -> AcceptanceItem {
    AcceptanceItem {
        id: id.into(),
        text: text.into(),
        done,
    }
}

fn fields(text: &str) -> Vec<String> {
    parse(text).defects.into_iter().map(|d| d.field).collect()
}

#[test]
fn a_frontmatter_with_acceptance_is_read_and_the_body_follows_it() {
    let text = "---\nacceptance:\n  - id: AC-1\n    text: 一覧をJSONで返す\n    done: false\n  - id: AC-2\n    text: 削除は確認を求める\n    done: true\n---\n\n## 背景\n\n本文。\n";
    let parsed = parse(text);
    assert!(parsed.defects.is_empty(), "{:?}", parsed.defects);
    assert_eq!(
        parsed.acceptance,
        vec![
            item("AC-1", "一覧をJSONで返す", false),
            item("AC-2", "削除は確認を求める", true),
        ]
    );
    assert_eq!(parsed.body, "## 背景\n\n本文。\n");
}

#[test]
fn a_file_without_frontmatter_is_a_body_with_no_conditions() {
    let text =
        "## Work\n\n旧形式の本文。\n\n## Completion conditions\n\n- [ ] AC-1. 旧形式の条件\n";
    let parsed = parse(text);
    assert!(parsed.defects.is_empty(), "{:?}", parsed.defects);
    assert!(parsed.acceptance.is_empty());
    assert_eq!(parsed.body, text);
}

#[test]
fn the_japanese_headings_of_earlier_files_are_not_checked_at_all() {
    let text = "## 作業内容\n\n作業。\n";
    assert!(parse(text).defects.is_empty());
    assert!(parse("").defects.is_empty());
}

#[test]
fn an_empty_frontmatter_and_a_null_acceptance_mean_no_conditions() {
    assert!(parse("---\n---\n\nbody\n").defects.is_empty());
    let parsed = parse("---\nacceptance:\n---\n\nbody\n");
    assert!(parsed.defects.is_empty(), "{:?}", parsed.defects);
    assert!(parsed.acceptance.is_empty());
}

#[test]
fn a_frontmatter_without_its_closing_line_is_a_defect_and_the_text_is_returned() {
    let text = "---\nacceptance: []\n\nbody\n";
    let parsed = parse(text);
    assert_eq!(fields(text), vec!["frontmatter"]);
    assert_eq!(parsed.body, text);
    assert!(parsed.acceptance.is_empty());
}

#[test]
fn invalid_yaml_is_a_defect() {
    assert_eq!(
        fields("---\nacceptance: [\n---\n\nbody\n"),
        vec!["frontmatter"]
    );
}

#[test]
fn a_frontmatter_that_is_not_a_mapping_is_a_defect() {
    assert_eq!(
        fields("---\n- one\n- two\n---\n\nbody\n"),
        vec!["frontmatter"]
    );
}

#[test]
fn acceptance_that_is_not_a_list_is_a_defect() {
    assert_eq!(
        fields("---\nacceptance: nope\n---\n\nbody\n"),
        vec!["acceptance"]
    );
}

#[test]
fn an_item_must_have_id_text_and_done_and_nothing_else() {
    let missing = "---\nacceptance:\n  - id: AC-1\n    text: 条件\n---\n";
    assert_eq!(fields(missing), vec!["acceptance[0].done"]);
    let extra =
        "---\nacceptance:\n  - id: AC-1\n    text: 条件\n    done: false\n    note: x\n---\n";
    assert_eq!(fields(extra), vec!["acceptance[0].note"]);
    let not_map = "---\nacceptance:\n  - AC-1\n---\n";
    assert_eq!(fields(not_map), vec!["acceptance[0]"]);
}

#[test]
fn the_id_must_be_ac_and_a_positive_number_without_leading_zero() {
    for bad in ["AC-0", "AC-01", "AC-", "AC-x", "ac-1", "1", "AC-1a"] {
        let text =
            format!("---\nacceptance:\n  - id: \"{bad}\"\n    text: 条件\n    done: false\n---\n");
        assert_eq!(fields(&text), vec!["acceptance[0].id"], "{bad}");
    }
}

#[test]
fn ids_must_be_unique_and_the_defect_names_the_later_item() {
    let text = "---\nacceptance:\n  - id: AC-1\n    text: 一\n    done: false\n  - id: AC-1\n    text: 二\n    done: false\n---\n";
    assert_eq!(fields(text), vec!["acceptance[1].id"]);
}

#[test]
fn text_must_not_be_blank_or_longer_than_two_thousand_characters() {
    let blank = "---\nacceptance:\n  - id: AC-1\n    text: \"   \"\n    done: false\n---\n";
    assert_eq!(fields(blank), vec!["acceptance[0].text"]);
    let long = format!(
        "---\nacceptance:\n  - id: AC-1\n    text: \"{}\"\n    done: false\n---\n",
        "q".repeat(2001)
    );
    assert_eq!(fields(&long), vec!["acceptance[0].text"]);
    let ok = format!(
        "---\nacceptance:\n  - id: AC-1\n    text: \"{}\"\n    done: false\n---\n",
        "q".repeat(2000)
    );
    assert!(parse(&ok).defects.is_empty());
}

#[test]
fn done_must_be_a_boolean() {
    let text = "---\nacceptance:\n  - id: AC-1\n    text: 条件\n    done: \"yes\"\n---\n";
    assert_eq!(fields(text), vec!["acceptance[0].done"]);
}

#[test]
fn a_defect_leaves_no_conditions_and_returns_the_body_after_the_frontmatter() {
    let text = "---\nacceptance:\n  - id: AC-1\n    text: 条件\n    done: false\n  - id: AC-1\n    text: 重複\n    done: false\n---\n\nbody\n";
    let parsed = parse(text);
    assert!(!parsed.defects.is_empty());
    assert!(parsed.acceptance.is_empty());
    assert_eq!(parsed.body, "body\n");
}

#[test]
fn an_unknown_top_level_key_is_kept_and_is_not_a_defect() {
    let text = "---\ntags:\n  - plan\nacceptance: []\n---\n\nbody\n";
    assert!(parse(text).defects.is_empty());
}

#[test]
fn crlf_is_read_like_lf() {
    let text = "---\r\nacceptance:\r\n  - id: AC-1\r\n    text: 条件\r\n    done: false\r\n---\r\n\r\nbody\r\n";
    let parsed = parse(text);
    assert!(parsed.defects.is_empty(), "{:?}", parsed.defects);
    assert_eq!(parsed.acceptance, vec![item("AC-1", "条件", false)]);
    assert_eq!(parsed.body, "body\n");
}

#[test]
fn compose_replaces_the_acceptance_and_keeps_other_keys_and_the_body_round_trips() {
    let original = "---\ntags:\n  - plan\nacceptance: []\n---\n\nold\n";
    let items = vec![item("AC-1", "一覧をJSONで返す", true)];
    let out = compose(original, "new body\n", Some(&items)).unwrap();
    assert!(out.starts_with("---\nacceptance:\n"), "{out}");
    assert!(out.contains("tags:"), "{out}");
    let back = parse(&out);
    assert!(back.defects.is_empty(), "{:?}\n{out}", back.defects);
    assert_eq!(back.acceptance, items);
    assert_eq!(back.body, "new body\n");
}

#[test]
fn compose_with_no_acceptance_keeps_the_acceptance_it_had() {
    let original = "---\nacceptance:\n  - id: AC-2\n    text: 残す\n    done: false\n---\n\nold\n";
    let out = compose(original, "changed\n", None).unwrap();
    let back = parse(&out);
    assert_eq!(back.acceptance, vec![item("AC-2", "残す", false)]);
    assert_eq!(back.body, "changed\n");
}

#[test]
fn compose_writes_an_empty_frontmatter_for_a_body_without_one() {
    let items: Vec<AcceptanceItem> = Vec::new();
    let out = compose("plain body\n", "plain body\n", Some(&items)).unwrap();
    assert_eq!(out, "---\nacceptance: []\n---\n\nplain body\n");
}

#[test]
fn compose_refuses_items_that_would_be_defects() {
    let items = vec![item("AC-1", "   ", false)];
    let error = compose("", "b", Some(&items)).unwrap_err();
    assert_eq!(error.field, "acceptance[0].text");
}

#[test]
fn compose_refuses_a_frontmatter_it_cannot_read_and_leaves_the_file_alone() {
    let broken = "---\nacceptance: [\n---\n\nbody\n";
    let items = vec![item("AC-1", "条件", false)];
    assert!(compose(broken, "body\n", Some(&items)).is_err());
    assert!(compose(broken, "body\n", None).is_err());
}

#[test]
fn compose_round_trips_a_body_that_starts_with_a_blank_line() {
    let body = "\n先頭に空行\n";
    let items: Vec<AcceptanceItem> = Vec::new();
    let out = compose("", body, Some(&items)).unwrap();
    assert_eq!(parse(&out).body, body);
}
