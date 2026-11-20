//! `agboard result add|ls`: results recorded with versions, safe to retry.

mod common;

use std::path::{Path, PathBuf};

use common::{demo_project, json_error, json_ok, png};
use serde_json::Value;

const P: [&str; 2] = ["--project", "Demo"];

fn run(home: &Path, rest: &[&str]) -> Value {
    json_ok(home, &[&P[..], rest, &["--json"]].concat())
}

fn add(home: &Path, task: &str, rest: &[&str]) -> Value {
    run(
        home,
        &[&["result", "add", task][..], rest, &["--actor", "ai"]].concat(),
    )
}

fn task_json(home: &Path, id: i64) -> PathBuf {
    fn find(dir: &Path, id: i64) -> Option<PathBuf> {
        for entry in std::fs::read_dir(dir).ok()?.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find(&path, id) {
                    return Some(found);
                }
            } else if path.file_name().is_some_and(|n| n == "task.json")
                && path.parent().and_then(|p| p.file_name()) == Some(id.to_string().as_ref())
            {
                return Some(path);
            }
        }
        None
    }
    find(home, id).expect("task.json")
}

#[test]
fn text_only_result_keeps_lane_and_state_and_retry_changes_nothing() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let before = run(home.path(), &["show", "1"]);
    assert_eq!(before["task"]["results"], serde_json::json!([]));

    let first = add(
        home.path(),
        "1",
        &["--summary", "First 30 seconds are ready"],
    );
    assert_eq!(first["created"], true);
    assert_eq!(first["result"]["version"], 1);
    assert_eq!(first["result"]["kind"], "progress");
    assert_eq!(first["result"]["summary"], "First 30 seconds are ready");
    assert!(first["result"].get("attachmentId").is_none());
    assert!(first["result"].get("link").is_none());

    let shown = run(home.path(), &["show", "1"]);
    let task = &shown["task"];
    assert_eq!(task["taskStatus"], before["task"]["taskStatus"]);
    assert_eq!(task["agentStatus"], before["task"]["agentStatus"]);
    assert_eq!(task["results"].as_array().unwrap().len(), 1);
    let history = task["history"].as_array().unwrap();
    assert_eq!(
        history.len(),
        before["task"]["history"].as_array().unwrap().len() + 1
    );
    assert!(
        history.last().unwrap()["reason"]
            .as_str()
            .unwrap()
            .starts_with("Recorded progress result v1: First 30 seconds")
    );

    // The same delivery again: same entry, nothing written, no new history.
    let retry = add(
        home.path(),
        "1",
        &["--summary", "First 30 seconds are ready"],
    );
    assert_eq!(retry["created"], false);
    assert_eq!(retry["result"], first["result"]);
    let again = run(home.path(), &["show", "1"]);
    assert_eq!(again["task"]["results"], task["results"]);
    assert_eq!(again["task"]["history"], task["history"]);
    assert_eq!(again["task"]["updatedAt"], task["updatedAt"]);

    // Different content is the next version.
    let second = add(home.path(), "1", &["--summary", "Second cut", "--final"]);
    assert_eq!(second["result"]["version"], 2);
    assert_eq!(second["result"]["kind"], "final");
    let listed = run(home.path(), &["result", "ls", "1"]);
    assert_eq!(listed["results"].as_array().unwrap().len(), 2);
}

#[test]
fn image_and_link_are_stored_once_and_retry_keeps_one_attachment() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let shot = home.path().join("shot.png");
    std::fs::write(&shot, png()).unwrap();
    let args = [
        "--summary",
        "Top page capture",
        "--file",
        shot.to_str().unwrap(),
        "--link",
        "https://example.com/draft.mp4",
    ];
    let first = add(home.path(), "1", &args);
    assert_eq!(first["created"], true);
    let attachment_id = first["result"]["attachmentId"].as_str().unwrap();
    assert_eq!(first["result"]["link"], "https://example.com/draft.mp4");
    assert_eq!(
        first["path"],
        format!("assets/{attachment_id}.png").as_str()
    );

    let retry = add(home.path(), "1", &args);
    assert_eq!(retry["created"], false);
    assert_eq!(retry["result"]["attachmentId"], attachment_id);
    let task = &run(home.path(), &["show", "1"])["task"];
    assert_eq!(task["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(task["results"].as_array().unwrap().len(), 1);

    let stored = std::fs::read_to_string(task_json(home.path(), 1)).unwrap();
    assert!(!stored.contains(home.path().to_str().unwrap()));
}

#[test]
fn explicit_key_dedupes_and_rejects_a_different_result() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let first = add(home.path(), "1", &["--summary", "A", "--key", "cut-1"]);
    assert_eq!(first["result"]["key"], "cut-1");
    let retry = add(home.path(), "1", &["--summary", "A", "--key", "cut-1"]);
    assert_eq!(retry["created"], false);
    let (_, code) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "result",
            "add",
            "1",
            "--summary",
            "B",
            "--key",
            "cut-1",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, "invalid_value");
    let listed = run(home.path(), &["result", "ls", "1"]);
    assert_eq!(listed["results"].as_array().unwrap().len(), 1);
}

#[test]
fn a_rejected_result_is_not_recorded_and_leaves_no_file() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let bad = home.path().join("bad.png");
    std::fs::write(&bad, b"not an image").unwrap();
    for rest in [
        vec!["--summary", "  "],
        vec!["--summary", "x", "--file", bad.to_str().unwrap()],
        vec!["--summary", "x", "--key", "bad key!"],
    ] {
        let (_, code) = json_error(
            home.path(),
            &[
                &["--project", "Demo", "result", "add", "1"][..],
                &rest,
                &["--actor", "ai"],
            ]
            .concat(),
        );
        assert_eq!(code, "invalid_value");
    }
    let task = &run(home.path(), &["show", "1"])["task"];
    assert_eq!(task["results"], serde_json::json!([]));
    assert_eq!(task["attachments"], serde_json::json!([]));
}

#[test]
fn tasks_without_results_read_as_before_and_store_no_results_key() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let stored = std::fs::read_to_string(task_json(home.path(), 1)).unwrap();
    assert!(!stored.contains("results"));
    let listed = run(home.path(), &["ls"]);
    assert_eq!(listed["tasks"][0]["results"], serde_json::json!([]));

    add(home.path(), "1", &["--summary", "Hello"]);
    let stored = std::fs::read_to_string(task_json(home.path(), 1)).unwrap();
    assert!(stored.contains("\"results\""));
    // The record still reads after a later change of another kind.
    run(
        home.path(),
        &["history", "add", "1", "--reason", "Went on working."],
    );
    let task = &run(home.path(), &["show", "1"])["task"];
    assert_eq!(task["results"].as_array().unwrap().len(), 1);
}

#[test]
fn a_done_task_refuses_a_new_result_but_a_retry_still_succeeds() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    add(home.path(), "1", &["--summary", "Done soon", "--final"]);
    // Mark the lane Done as a person would.
    json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "1",
            "done",
            "--actor",
            "human",
            "--reason",
            "Accepted.",
            "--json",
        ],
    );
    let retry = add(home.path(), "1", &["--summary", "Done soon", "--final"]);
    assert_eq!(retry["created"], false);
    let (_, code) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "result",
            "add",
            "1",
            "--summary",
            "Late",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, "task_is_done");
}

#[test]
fn same_key_and_size_but_different_image_bytes_is_a_conflict() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    // Two valid PNGs of the same length with different pixels.
    let image = image::RgbaImage::from_pixel(1, 1, image::Rgba([1, 2, 3, 255]));
    let other = image::RgbaImage::from_pixel(1, 1, image::Rgba([9, 8, 7, 255]));
    let encode = |img: &image::RgbaImage| {
        let mut out = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    };
    let (a, b) = (encode(&image), encode(&other));
    assert_eq!(a.len(), b.len());
    assert_ne!(a, b);
    let (fa, fb) = (home.path().join("a.png"), home.path().join("b.png"));
    std::fs::write(&fa, &a).unwrap();
    std::fs::write(&fb, &b).unwrap();
    let args = |f: &PathBuf| {
        vec![
            "--summary".to_string(),
            "S".into(),
            "--key".into(),
            "k1".into(),
            "--file".into(),
            f.to_str().unwrap().into(),
        ]
    };
    let call = |f: &PathBuf| {
        let owned = args(f);
        let refs: Vec<&str> = owned.iter().map(String::as_str).collect();
        add(home.path(), "1", &refs)
    };
    let first = call(&fa);
    assert_eq!(first["created"], true);
    assert_eq!(call(&fa)["created"], false);
    let owned = args(&fb);
    let refs: Vec<&str> = owned.iter().map(String::as_str).collect();
    let (_, code) = json_error(
        home.path(),
        &[
            &["--project", "Demo", "result", "add", "1"][..],
            &refs,
            &["--actor", "ai"],
        ]
        .concat(),
    );
    assert_eq!(code, "invalid_value");
    let task = &run(home.path(), &["show", "1"])["task"];
    assert_eq!(task["results"].as_array().unwrap().len(), 1);
    assert_eq!(task["attachments"].as_array().unwrap().len(), 1);
}

#[test]
fn a_result_has_the_title_given_or_the_first_sentence_of_its_summary() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());

    let given = add(
        home.path(),
        "1",
        &["--title", "  First draft  ", "--summary", "Body. More."],
    );
    assert_eq!(given["result"]["title"], "First draft");

    let derived = add(
        home.path(),
        "1",
        &["--summary", "Top page is ready. Spacing is next."],
    );
    assert_eq!(derived["result"]["title"], "Top page is ready.");
    let japanese = add(
        home.path(),
        "1",
        &["--summary", "一覧画面ができました。次は詳細です。"],
    );
    assert_eq!(japanese["result"]["title"], "一覧画面ができました。");
    let long = add(home.path(), "1", &["--summary", &"a".repeat(200)]);
    let title = long["result"]["title"].as_str().unwrap();
    assert_eq!(title.chars().count(), 80);
    assert!(title.ends_with('…'));

    // A retry with the same title finds the entry; another title is a different result.
    let retry = add(
        home.path(),
        "1",
        &["--title", "First draft", "--summary", "Body. More."],
    );
    assert_eq!(retry["created"], false);
    let listed = run(home.path(), &["result", "ls", "1"]);
    assert_eq!(listed["results"][0]["title"], "First draft");
}

#[test]
fn a_title_over_80_characters_or_on_several_lines_is_refused() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    for title in ["a".repeat(81), "one\ntwo".to_string(), "   ".to_string()] {
        let (_, code) = json_error(
            home.path(),
            &[
                "--project",
                "Demo",
                "result",
                "add",
                "1",
                "--summary",
                "S",
                "--title",
                &title,
                "--actor",
                "ai",
            ],
        );
        assert_eq!(code, "invalid_value");
    }
    assert_eq!(
        run(home.path(), &["result", "ls", "1"])["results"],
        serde_json::json!([])
    );
}

#[test]
fn a_result_stored_without_a_title_reads_with_the_first_sentence() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    add(home.path(), "1", &["--summary", "Old one. Details."]);
    let path = task_json(home.path(), 1);
    let mut value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    value["results"][0].as_object_mut().unwrap().remove("title");
    std::fs::write(&path, serde_json::to_string(&value).unwrap()).unwrap();
    let listed = run(home.path(), &["result", "ls", "1"]);
    assert_eq!(listed["results"][0]["title"], "Old one.");
}
