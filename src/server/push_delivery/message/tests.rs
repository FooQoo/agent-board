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
    assert_eq!(result.title, "A result is ready to look at");
    assert_eq!(result.body, "#12 Make the thing\nLooks good");
    assert_eq!(result.tag, "key-1");
    assert!(!result.urgent);

    let question = payload_of(&event(Kind::Question, None, "Which?"), Lang::En, &origin()).unwrap();
    assert_eq!(question.path, format!("/?project={PROJECT}&task=12"));
    assert!(question.urgent);
}

#[test]
fn the_wording_follows_the_language() {
    let e = event(Kind::History, None, "");
    let ja = payload_of(&e, Lang::Ja, &origin()).unwrap();
    assert_eq!(ja.title, "履歴が追加されました");
    assert_eq!(ja.body, "#12 Make the thing");
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
        format!("https://board.example.dev/?project={PROJECT}&task=12")
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
