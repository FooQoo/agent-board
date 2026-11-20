use super::*;
use crate::server::push_delivery::events::Event;

const PROJECT: &str = "0123456789abcdef0123456789abcdef";

fn origin() -> PublicOrigin {
    PublicOrigin::parse("https://board.example.dev").unwrap()
}

fn event(kind: Kind, version: Option<u32>, detail: &str) -> Event {
    Event {
        project: PROJECT.to_string(),
        task: 12,
        title: "Make the thing".to_string(),
        kind,
        key: "key-1".to_string(),
        version,
        question_id: None,
        detail: detail.to_string(),
    }
}

#[test]
fn a_result_links_to_its_version_and_a_question_to_the_card() {
    let result = payload_of(
        &event(Kind::Result(ResultKind::Progress), Some(3), "Looks good"),
        Lang::En,
        &origin(),
    )
    .unwrap();
    assert_eq!(result.path, format!("/?project={PROJECT}&task=12&result=3"));
    assert_eq!(result.title, "Make the thing");
    assert_eq!(result.body, "Looks good");
    assert_eq!(result.tag, "key-1");
    assert!(!result.urgent);

    let question = payload_of(&event(Kind::Question, None, "Which?"), Lang::En, &origin()).unwrap();
    assert_eq!(question.path, format!("/?project={PROJECT}&task=12"));
    assert!(question.urgent);

    let mut asked = event(Kind::Question, None, "Which?");
    asked.question_id = Some("Q-7".to_string());
    let asked = payload_of(&asked, Lang::En, &origin()).unwrap();
    assert_eq!(
        asked.path,
        format!("/?project={PROJECT}&task=12&question=Q-7")
    );
    assert!(asked.urgent);
}

#[test]
fn a_history_entry_links_to_the_history_tab_of_the_card() {
    let history = payload_of(
        &event(Kind::History, None, "Did a thing"),
        Lang::En,
        &origin(),
    )
    .unwrap();
    assert_eq!(
        history.path,
        format!("/?project={PROJECT}&task=12&tab=history")
    );
}

#[test]
fn the_wording_follows_the_language() {
    let e = event(Kind::History, None, "");
    let ja = payload_of(&e, Lang::Ja, &origin()).unwrap();
    assert_eq!(ja.title, "Make the thing");
    assert_eq!(ja.body, "履歴が追加されました");
    assert_eq!(Lang::from_locale("ja"), Lang::Ja);
    assert_eq!(Lang::from_locale("en"), Lang::En);
    assert_eq!(Lang::from_locale("fr"), Lang::En);
}

#[test]
fn the_json_has_the_full_address_and_nothing_else_is_added() {
    let p = payload_of(
        &event(Kind::History, None, "Did a thing"),
        Lang::En,
        &origin(),
    )
    .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&p.json(&origin())).unwrap();
    assert_eq!(
        json["url"],
        format!("https://board.example.dev/?project={PROJECT}&task=12&tab=history")
    );
    let mut keys: Vec<&str> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    assert_eq!(keys, ["body", "tag", "title", "url"]);
    // The path survives an address change.
    let other = PublicOrigin::parse("https://other.example.dev").unwrap();
    let moved: serde_json::Value = serde_json::from_slice(&p.json(&other)).unwrap();
    assert!(
        moved["url"]
            .as_str()
            .unwrap()
            .starts_with("https://other.example.dev/?project=")
    );
}

#[test]
fn an_event_without_a_valid_link_is_not_sent() {
    let mut e = event(Kind::Question, None, "x");
    e.project = "nope".to_string();
    assert_eq!(payload_of(&e, Lang::En, &origin()), None);
}

#[test]
fn text_is_one_short_line() {
    assert_eq!(shorten("a\n  b\tc", 10), "a b c");
    let long = "x".repeat(300);
    let cut = shorten(&long, 140);
    assert_eq!(cut.chars().count(), 140);
    assert!(cut.ends_with('…'));
}

#[test]
fn the_detail_is_cut_to_forty_characters() {
    let e = event(Kind::Question, None, &"y".repeat(300));
    let body = payload_of(&e, Lang::En, &origin()).unwrap().body;
    assert_eq!(body.chars().count(), 40);
    assert!(body.ends_with('…'));
}

#[test]
fn the_line_is_the_first_sentence() {
    for (detail, line) in [
        ("Pick one. The rest can wait.", "Pick one."),
        ("どちらにしますか？ 理由も書きます。", "どちらにしますか？"),
        ("要約です。続きの文", "要約です。"),
        ("First line\nsecond line", "First line"),
        ("Version 1.6 is out", "Version 1.6 is out"),
    ] {
        let p = payload_of(&event(Kind::History, None, detail), Lang::En, &origin()).unwrap();
        assert_eq!(p.body, line);
    }
}

#[test]
fn markdown_marks_are_not_shown_in_the_line() {
    for (detail, line) in [
        ("**Which one?** The rest", "Which one?"),
        ("## Use `cargo test`. Then more", "Use cargo test."),
        ("- See [the docs](https://x.y) now", "See the docs now"),
    ] {
        let p = payload_of(&event(Kind::Question, None, detail), Lang::En, &origin()).unwrap();
        assert_eq!(p.body, line);
    }
}
