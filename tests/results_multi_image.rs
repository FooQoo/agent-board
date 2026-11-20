//! Several images on one result: order, old single-image data, the cap, atomic cleanup,
//! and the rule that an image a result uses cannot be deleted.

mod common;

use std::path::{Path, PathBuf};

use agent_board::domain::{Actor, Assignee, AttachmentInput, NewTask, ResultKind, TaskResult};
use agent_board::error::AgboardError;
use agent_board::file_store::model::AttachmentOwner;
use agent_board::file_store::{FileStore, ResultInput};
use chrono::{TimeZone, Utc};
use common::{demo_project, json_error, json_ok};
use serde_json::Value;

fn run(home: &Path, rest: &[&str]) -> Value {
    json_ok(
        home,
        &[&["--project", "Demo"][..], rest, &["--json"]].concat(),
    )
}

/// A valid 1x1 PNG whose pixel depends on `n`, so each image has its own bytes.
fn colored(n: u8) -> Vec<u8> {
    let img = image::RgbaImage::from_pixel(1, 1, image::Rgba([n, 2, 3, 255]));
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    out
}

fn files(home: &Path, count: u8) -> Vec<PathBuf> {
    (1..=count)
        .map(|n| {
            let path = home.join(format!("{n:02}.png"));
            std::fs::write(&path, colored(n)).unwrap();
            path
        })
        .collect()
}

fn add_args<'a>(paths: &'a [String], extra: &[&'a str]) -> Vec<&'a str> {
    let mut args = vec!["result", "add", "1", "--summary", "Mock screens"];
    for path in paths {
        args.push("--file");
        args.push(path);
    }
    args.extend_from_slice(extra);
    args.extend_from_slice(&["--actor", "ai"]);
    args
}

fn strings(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .map(|p| p.to_str().unwrap().to_owned())
        .collect()
}

fn asset_count(home: &Path) -> usize {
    fn walk(dir: &Path, n: &mut usize) {
        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, n);
            } else if path.parent().and_then(|p| p.file_name()) == Some("assets".as_ref()) {
                *n += 1;
            }
        }
    }
    let mut n = 0;
    walk(home, &mut n);
    n
}

#[test]
fn several_files_become_one_result_with_ordered_images_and_retry_is_safe() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let paths = strings(&files(home.path(), 3));
    let args = add_args(&paths, &[]);

    let first = run(home.path(), &args);
    assert_eq!(first["created"], true);
    let ids: Vec<&str> = first["result"]["attachmentIds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), 3);
    assert!(first["result"].get("attachmentId").is_none());
    assert_eq!(first["attachments"].as_array().unwrap().len(), 3);
    assert_eq!(first["paths"].as_array().unwrap().len(), 3);
    assert_eq!(first["path"], first["paths"][0]);
    for (n, id) in ids.iter().enumerate() {
        assert_eq!(first["paths"][n], format!("assets/{id}.png").as_str());
    }

    let retry = run(home.path(), &args);
    assert_eq!(retry["created"], false);
    assert_eq!(
        retry["result"]["attachmentIds"],
        first["result"]["attachmentIds"]
    );
    assert_eq!(retry["attachments"].as_array().unwrap().len(), 3);
    let task = &run(home.path(), &["show", "1"])["task"];
    assert_eq!(task["attachments"].as_array().unwrap().len(), 3);
    assert_eq!(task["results"].as_array().unwrap().len(), 1);
}

#[test]
fn the_default_key_depends_on_the_order_and_the_set_of_images() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let mut paths = strings(&files(home.path(), 2));
    let first = run(home.path(), &add_args(&paths, &[]));
    paths.reverse();
    let reversed = run(home.path(), &add_args(&paths, &[]));
    assert_eq!(reversed["created"], true);
    assert_ne!(first["result"]["key"], reversed["result"]["key"]);
    let one = run(home.path(), &add_args(&paths[..1], &[]));
    assert_eq!(one["created"], true);
}

#[test]
fn one_file_keeps_the_single_image_field_that_older_versions_read() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let paths = strings(&files(home.path(), 1));
    let added = run(home.path(), &add_args(&paths, &[]));
    assert!(added["result"]["attachmentId"].is_string());
    assert!(added["result"].get("attachmentIds").is_none());
    assert_eq!(added["attachments"].as_array().unwrap().len(), 1);
}

#[test]
fn the_same_key_with_a_different_image_list_is_a_conflict() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let paths = strings(&files(home.path(), 2));
    run(home.path(), &add_args(&paths, &["--key", "k"]));
    let (_, code) = json_error(
        home.path(),
        &[
            &["--project", "Demo"][..],
            &add_args(&paths[..1], &["--key", "k"]),
        ]
        .concat(),
    );
    assert_eq!(code, "invalid_value");
}

#[test]
fn more_than_twenty_images_are_refused_and_nothing_is_written() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let paths = strings(&files(home.path(), 21));
    let (_, code) = json_error(
        home.path(),
        &[&["--project", "Demo"][..], &add_args(&paths, &[])].concat(),
    );
    assert_eq!(code, "invalid_value");
    let task = &run(home.path(), &["show", "1"])["task"];
    assert_eq!(task["results"], serde_json::json!([]));
    assert_eq!(task["attachments"], serde_json::json!([]));
    assert_eq!(asset_count(home.path()), 0);

    let twenty = strings(&files(home.path(), 20));
    assert_eq!(run(home.path(), &add_args(&twenty, &[]))["created"], true);
}

#[test]
fn a_bad_image_in_the_list_records_nothing_and_leaves_no_image_file() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let mut paths = files(home.path(), 2);
    let bad = home.path().join("bad.png");
    std::fs::write(&bad, b"not an image").unwrap();
    paths.push(bad);
    let (_, code) = json_error(
        home.path(),
        &[&["--project", "Demo"][..], &add_args(&strings(&paths), &[])].concat(),
    );
    assert_eq!(code, "invalid_value");
    let task = &run(home.path(), &["show", "1"])["task"];
    assert_eq!(task["results"], serde_json::json!([]));
    assert_eq!(task["attachments"], serde_json::json!([]));
    assert_eq!(asset_count(home.path()), 0);
}

#[test]
fn older_single_image_json_and_new_list_json_both_read_as_image_ids() {
    let old: TaskResult = serde_json::from_value(serde_json::json!({
        "version": 1, "key": "k", "kind": "final", "summary": "S",
        "attachmentId": "a", "at": "2026-11-20T01:00:00Z"
    }))
    .unwrap();
    assert_eq!(old.image_ids(), vec!["a"]);
    let many: TaskResult = serde_json::from_value(serde_json::json!({
        "version": 2, "key": "k2", "kind": "final", "summary": "S",
        "attachmentIds": ["a", "b", "c"], "at": "2026-11-20T01:00:00Z"
    }))
    .unwrap();
    assert_eq!(many.image_ids(), vec!["a", "b", "c"]);
    let none: TaskResult = serde_json::from_value(serde_json::json!({
        "version": 3, "key": "k3", "kind": "final", "summary": "S",
        "at": "2026-11-20T01:00:00Z"
    }))
    .unwrap();
    assert!(none.image_ids().is_empty());
    let written = serde_json::to_value(old.with_images(vec!["x".into(), "y".into()])).unwrap();
    assert!(written.get("attachmentId").is_none());
    assert_eq!(written["attachmentIds"], serde_json::json!(["x", "y"]));
}

#[test]
fn an_image_used_by_any_image_of_a_result_cannot_be_deleted() {
    let at = Utc.with_ymd_and_hms(2026, 11, 20, 0, 0, 0).unwrap();
    let root = tempfile::tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let project = store.create_project("Alpha", at).unwrap().id;
    let task = store
        .create_task(
            &project,
            NewTask {
                title: "T".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                draft: None,
            },
            at,
        )
        .unwrap()
        .id;
    let images = (1..=2u8)
        .map(|n| AttachmentInput {
            id: format!("{n:032x}"),
            name: format!("{n}.png"),
            bytes: colored(n),
        })
        .collect();
    let recorded = store
        .add_result(
            &project,
            task,
            ResultInput {
                title: None,
                kind: ResultKind::Final,
                summary: "S".into(),
                link: None,
                images,
                key: None,
            },
            at,
        )
        .unwrap();
    assert_eq!(recorded.attachments.len(), 2);
    let owner = AttachmentOwner::Task(task);
    for attachment in &recorded.attachments {
        let error = store
            .delete_attachment(&project, &owner, &attachment.id, at)
            .unwrap_err();
        assert!(
            matches!(error, AgboardError::InvalidValue { .. }),
            "{error:?}"
        );
    }
}
