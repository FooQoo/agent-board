use super::*;
use crate::file_store::FileStore;
use crate::nudge::test_support::{Scenario, call, progress_with};

fn decide_for(scenario: &Scenario) -> Option<String> {
    decide(&scenario.facts(), RULES)
}

fn reason(out: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(out).unwrap();
    assert_eq!(v["decision"], "block");
    v["reason"].as_str().unwrap().to_string()
}

#[test]
fn the_checklist_separates_found_items_from_checks() {
    let scenario = Scenario::turn(
        "Shall I merge?",
        vec![call("gh pr create --title x")],
        Some(progress_with(true, &[3])),
    );
    let reason = reason(&decide_for(&scenario).unwrap());
    assert!(reason.starts_with("Agent Board turn-end checklist."));
    let found = reason.find("\nFound:\n").unwrap();
    let check = reason.find("\nCheck:\n").unwrap();
    assert!(found < check);
    let (found_part, check_part) = (&reason[found..check], &reason[check..]);
    assert!(found_part.contains("- NG: Task #3 has all conditions met"));
    assert!(found_part.contains("- NG: You opened a pull request"));
    assert!(!found_part.contains("[ ]"));
    assert!(check_part.contains("- [ ] Does your question wait"));
    assert!(check_part.contains("- [ ] Record a decision that matters later"));
    assert!(!check_part.contains("NG:"));
}

#[test]
fn an_empty_section_is_left_out_and_no_item_means_no_block() {
    let only_checks = Scenario::turn("Shall I?", vec![call("ls")], None);
    let r = reason(&decide_for(&only_checks).unwrap());
    assert!(r.contains("Check:") && !r.contains("Found:"));
    let only_found = Scenario::turn("Done.", vec![], Some(progress_with(false, &[4])));
    let r = reason(&decide_for(&only_found).unwrap());
    assert!(r.contains("Found:") && !r.contains("Check:"));
    let none = Scenario::turn("All done.", vec![], Some(progress_with(true, &[])));
    assert!(decide_for(&none).is_none());
}

#[test]
fn an_active_stop_hook_never_blocks() {
    let home = tempfile::tempdir().unwrap();
    let shared = home.path().join("shared");
    let project = FileStore::open(&shared)
        .create_project("Demo", chrono::Utc::now())
        .unwrap()
        .id;
    // Without a transcript the question rule cannot match, so use a file.
    let path = home.path().join("t.jsonl");
    std::fs::write(
        &path,
        r#"{"type":"user","message":{"role":"user","content":"hi"}}"#,
    )
    .unwrap();
    let input = |active| StopFields {
        stop_hook_active: Some(active),
        last_assistant_message: Some("May I proceed?".into()),
        transcript_path: path.to_str().map(String::from),
        ..Default::default()
    };
    assert!(run(&input(false), &shared, &project).is_some());
    assert!(run(&input(true), &shared, &project).is_none());
}
