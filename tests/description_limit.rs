//! The 50,000-character limit counts the Markdown body of a task. The frontmatter
//! the product writes around the body is not counted, so a body of exactly the
//! limit can be saved with its conditions.

mod common;

use common::{agboard, demo_project};

fn add_with_body(home: &std::path::Path, body: &str) -> (i32, String) {
    let text =
        format!("---\nacceptance:\n  - id: AC-1\n    text: Works\n    done: false\n---\n\n{body}");
    let file = home.join("desc.md");
    std::fs::write(&file, text).unwrap();
    let (code, _, err) = agboard(
        home,
        &[
            "--project",
            "Demo",
            "add",
            "Task",
            "--assignee",
            "ai",
            "--actor",
            "ai",
            "--desc-file",
            file.to_str().unwrap(),
        ],
    );
    (code, err)
}

#[test]
fn a_body_of_exactly_the_limit_is_saved_with_its_frontmatter() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, err) = add_with_body(home.path(), &"あ".repeat(50_000));
    assert_eq!(code, 0, "{err}");
}

#[test]
fn a_body_one_character_over_the_limit_is_refused() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, err) = add_with_body(home.path(), &"あ".repeat(50_001));
    assert_ne!(code, 0, "{err}");
    assert!(err.contains("50,000"), "{err}");
}
