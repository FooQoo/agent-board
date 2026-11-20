//! The CLI for epics, epic membership, and task images (AC-2
//! and AC-5's CLI side, U6-1, U6-5, U6-6, and the draft rule of U6-8). Each
//! test runs the real binary against a temporary data area.

mod common;

use std::path::Path;

use agent_board::domain::ProjectId;
use agent_board::file_store::FileStore;
use common::{agboard, demo_project, json_error, json_ok, png};
use serde_json::Value;

fn project_id(home: &Path) -> ProjectId {
    let id = json_ok(home, &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    id.parse().unwrap()
}

fn epic_add(home: &Path, id: &str, name: &str, color: Option<&str>) {
    let mut args = vec![
        "--project",
        "Demo",
        "epic",
        "add",
        id,
        "--name",
        name,
        "--actor",
        "human",
    ];
    if let Some(color) = color {
        args.extend(["--color", color]);
    }
    let (code, _, err) = agboard(home, &args);
    assert_eq!(code, 0, "epic add failed: {err}");
}

#[test]
fn epic_add_writes_the_epic_and_an_empty_document() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "file-share", "File share", Some("#7c3aed"));

    let shown = json_ok(
        home.path(),
        &["--project", "Demo", "epic", "show", "FILE-SHARE", "--json"],
    );
    assert_eq!(shown["epic"]["id"], "FILE-SHARE");
    assert_eq!(shown["epic"]["name"], "File share");
    assert_eq!(shown["epic"]["color"], "#7C3AED");
    assert_eq!(shown["epic"]["draft"], serde_json::Value::Null);
    let document = shown["epic"]["document"].as_str().unwrap();
    assert_eq!(document, "", "the new document is empty");
}

#[test]
fn a_color_left_out_is_random_saved_and_stays_the_same_on_later_reads() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "ALPHA", "Alpha", None);
    epic_add(home.path(), "BETA", "Beta", None);

    let first = json_ok(
        home.path(),
        &["--project", "Demo", "epic", "show", "ALPHA", "--json"],
    );
    let color = first["epic"]["color"].as_str().unwrap().to_string();
    assert!(
        color.len() == 7
            && color.starts_with('#')
            && color[1..].chars().all(|c| c.is_ascii_hexdigit()),
        "{color}"
    );
    let again = json_ok(
        home.path(),
        &["--project", "Demo", "epic", "show", "ALPHA", "--json"],
    );
    assert_eq!(again["epic"]["color"], color.as_str());
    let beta = json_ok(
        home.path(),
        &["--project", "Demo", "epic", "show", "BETA", "--json"],
    );
    assert_ne!(
        beta["epic"]["color"],
        color.as_str(),
        "a saved color is not reused"
    );
}

#[test]
fn an_epic_id_that_is_taken_is_refused_and_nothing_changes() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "FILE-SHARE", "File share", Some("#111111"));
    let (code, code_name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "add",
            "FILE-SHARE",
            "--name",
            "Other",
            "--actor",
            "ai",
        ],
    );
    assert_eq!((code, code_name.as_str()), (1, "epic_id_taken"));
    let shown = json_ok(
        home.path(),
        &["--project", "Demo", "epic", "show", "FILE-SHARE", "--json"],
    );
    assert_eq!(shown["epic"]["name"], "File share");
}

#[test]
fn epic_edit_changes_the_name_the_color_and_the_document_from_a_file() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "FILE-SHARE", "File share", Some("#111111"));
    let document = home.path().join("document.md");
    std::fs::write(
        &document,
        "---\nacceptance:\n  - id: AC-1\n    text: Works\n    done: false\n---\n\nShare files.\n\nThe board.\n\nStep one.\n",
    )
    .unwrap();
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "FILE-SHARE",
            "--name",
            "Shared files",
            "--color",
            "#22aa33",
            "--document-file",
            document.to_str().unwrap(),
        ],
    );
    assert_eq!(code, 0, "{err}");
    let shown = json_ok(
        home.path(),
        &["--project", "Demo", "epic", "show", "FILE-SHARE", "--json"],
    );
    assert_eq!(shown["epic"]["name"], "Shared files");
    assert_eq!(shown["epic"]["color"], "#22AA33");
    assert!(
        shown["epic"]["document"]
            .as_str()
            .unwrap()
            .contains("Step one.")
    );
}

#[test]
fn edit_sets_and_clears_the_epic_of_a_task_and_ls_filters_by_it() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "FILE-SHARE", "File share", Some("#111111"));

    let (code, _, err) = agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--epic", "FILE-SHARE"],
    );
    assert_eq!(code, 0, "{err}");
    let listed = json_ok(home.path(), &["--project", "Demo", "ls", "--json"]);
    assert_eq!(listed["tasks"][0]["epicId"], "FILE-SHARE");
    assert_eq!(listed["tasks"][0]["epic"]["id"], "FILE-SHARE");
    assert_eq!(listed["tasks"][0]["epic"]["color"], "#111111");
    let filtered = json_ok(
        home.path(),
        &["--project", "Demo", "ls", "--epic", "FILE-SHARE", "--json"],
    );
    assert_eq!(filtered["tasks"].as_array().unwrap().len(), 1);
    let other = json_ok(
        home.path(),
        &["--project", "Demo", "ls", "--epic", "NOPE-1", "--json"],
    );
    assert_eq!(other["tasks"].as_array().unwrap().len(), 0);

    let (code, _, err) = agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--clear-epic"],
    );
    assert_eq!(code, 0, "{err}");
    let cleared = json_ok(home.path(), &["--project", "Demo", "ls", "--json"]);
    assert_eq!(cleared["tasks"][0]["epicId"], Value::Null);
    assert_eq!(cleared["tasks"][0]["epic"], Value::Null);
}

#[test]
fn the_human_list_shows_the_epic_id_of_a_task() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "FILE-SHARE", "File share", Some("#111111"));
    agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--epic", "FILE-SHARE"],
    );
    let (code, out, err) = agboard(home.path(), &["--project", "Demo", "ls"]);
    assert_eq!(code, 0, "{err}");
    assert!(out.contains("FILE-SHARE"), "{out}");
}

#[test]
fn an_unknown_epic_is_refused_and_the_task_keeps_its_epic() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, code_name) = json_error(
        home.path(),
        &["--project", "Demo", "edit", "1", "--epic", "NOPE"],
    );
    assert_eq!((code, code_name.as_str()), (1, "epic_not_found"));
    let task = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    assert_eq!(task["task"]["epicId"], Value::Null);
}

#[test]
fn epic_ls_json_lists_each_epic_with_its_color_and_task_count() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "FILE-SHARE", "File share", Some("#111111"));
    epic_add(home.path(), "ALPHA", "Alpha", Some("#222222"));
    agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--epic", "FILE-SHARE"],
    );

    let listed = json_ok(home.path(), &["--project", "Demo", "epic", "ls", "--json"]);
    let epics = listed["epics"].as_array().unwrap();
    // The two default epics are listed with the ones added here.
    let ids: Vec<&str> = epics
        .iter()
        .map(|epic| epic["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["ALPHA", "BUG", "ENHANCEMENT", "FILE-SHARE"]);
    let by_id = |id: &str| epics.iter().find(|epic| epic["id"] == id).unwrap();
    assert_eq!(by_id("FILE-SHARE")["name"], "File share");
    assert_eq!(by_id("FILE-SHARE")["color"], "#111111");
    assert_eq!(by_id("FILE-SHARE")["taskCount"], 1);
    assert_eq!(by_id("ALPHA")["taskCount"], 0);
}

#[test]
fn epic_rm_without_a_terminal_is_refused_and_changes_nothing() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "FILE-SHARE", "File share", Some("#111111"));
    let (code, code_name) = json_error(
        home.path(),
        &["--project", "Demo", "epic", "rm", "FILE-SHARE"],
    );
    assert_eq!((code, code_name.as_str()), (1, "confirmation_required"));
    json_ok(
        home.path(),
        &["--project", "Demo", "epic", "show", "FILE-SHARE", "--json"],
    );
}

#[test]
fn an_image_added_from_the_cli_returns_its_asset_path_and_can_be_read_back() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let file = home.path().join("shot.png");
    std::fs::write(&file, png()).unwrap();

    let added = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "attachment",
            "add",
            "1",
            "--file",
            file.to_str().unwrap(),
            "--actor",
            "ai",
            "--json",
        ],
    );
    let id = added["attachment"]["id"].as_str().unwrap().to_string();
    assert_eq!(added["path"], format!("assets/{id}.png").as_str());

    let listed = json_ok(
        home.path(),
        &["--project", "Demo", "attachment", "ls", "1", "--json"],
    );
    assert_eq!(listed["attachments"][0]["id"], id.as_str());

    let out = home.path().join("back.png");
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "attachment",
            "get",
            "1",
            &id,
            "--output",
            out.to_str().unwrap(),
        ],
    );
    assert_eq!(code, 0, "{err}");
    assert_eq!(std::fs::read(&out).unwrap(), png());
}

#[test]
fn a_draft_epic_refuses_cli_edit_but_reads_and_member_work_still_work() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "FILE-SHARE", "File share", Some("#111111"));
    let store = FileStore::open(&home.path().join("shared"));
    let project = project_id(home.path());
    let epic = agent_board::file_store::validate::EpicId::normalize("FILE-SHARE").unwrap();
    store
        .update_epic(
            &project,
            &epic,
            agent_board::file_store::model::EpicUpdate {
                draft: Some(Some(agent_board::domain::Draft::Human)),
                ..Default::default()
            },
            chrono::Utc::now(),
        )
        .unwrap();

    for args in [
        vec!["epic", "edit", "FILE-SHARE", "--name", "Renamed"],
        vec!["epic", "edit", "FILE-SHARE", "--color", "#222222"],
        vec![
            "epic",
            "edit",
            "FILE-SHARE",
            "--document",
            "---\n---\n\nx\n",
        ],
        vec!["epic", "edit", "FILE-SHARE", "--waves", "1"],
    ] {
        let mut full = vec!["--project", "Demo"];
        full.extend(args);
        let (code, code_name) = json_error(home.path(), &full);
        assert_eq!((code, code_name.as_str()), (1, "epic_is_draft"), "{full:?}");
    }
    let shown = json_ok(
        home.path(),
        &["--project", "Demo", "epic", "show", "FILE-SHARE", "--json"],
    );
    assert_eq!(shown["epic"]["name"], "File share");

    // A task of the draft epic keeps working.
    let (code, _, err) = agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--epic", "FILE-SHARE"],
    );
    assert_eq!(code, 0, "{err}");
}

#[test]
fn a_draft_task_refuses_cli_image_and_epic_changes_but_reads_still_work() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "FILE-SHARE", "File share", Some("#111111"));
    let shot = home.path().join("shot.png");
    std::fs::write(&shot, png()).unwrap();

    // A person marks the task as a draft through the Web path (the store API).
    let store = FileStore::open(&home.path().join("shared"));
    store
        .set_draft(
            &project_id(home.path()),
            1,
            Some(agent_board::domain::Draft::Human),
            false,
            chrono::Utc::now(),
        )
        .unwrap();

    let (code, code_name) = json_error(
        home.path(),
        &["--project", "Demo", "edit", "1", "--epic", "FILE-SHARE"],
    );
    assert_eq!((code, code_name.as_str()), (1, "task_is_draft"));
    let (code, code_name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "attachment",
            "add",
            "1",
            "--file",
            shot.to_str().unwrap(),
            "--actor",
            "human",
        ],
    );
    assert_eq!((code, code_name.as_str()), (1, "task_is_draft"));
    let shown = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    assert_eq!(shown["task"]["draft"], "human");
    assert_eq!(shown["task"]["epicId"], Value::Null);
}

#[test]
fn epic_document_accepts_100000_characters_and_refuses_one_more() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "BIG-DOC", "Big document", None);
    let document = home.path().join("document.md");
    let edit = |count: usize| {
        std::fs::write(&document, "あ".repeat(count)).unwrap();
        agboard(
            home.path(),
            &[
                "--project",
                "Demo",
                "epic",
                "edit",
                "BIG-DOC",
                "--document-file",
                document.to_str().unwrap(),
            ],
        )
    };
    let (code, _, err) = edit(100_000);
    assert_eq!(code, 0, "{err}");
    let (code, _, err) = edit(100_001);
    assert_ne!(code, 0);
    assert!(err.contains("100,000"), "{err}");
}

/// Add tasks 2 to 4 to the demo project and put tasks 1 to 4 into the epic.
fn epic_with_four_tasks(home: &Path) {
    epic_add(home, "FILE-SHARE", "File share", Some("#111111"));
    for title in ["Second", "Third", "Fourth"] {
        let (code, _, err) = agboard(
            home,
            &[
                "--project",
                "Demo",
                "add",
                title,
                "--assignee",
                "ai",
                "--actor",
                "human",
            ],
        );
        assert_eq!(code, 0, "{err}");
    }
    for id in ["1", "2", "3", "4"] {
        let (code, _, err) = agboard(
            home,
            &["--project", "Demo", "edit", id, "--epic", "FILE-SHARE"],
        );
        assert_eq!(code, 0, "{err}");
    }
}

fn waves_of(home: &Path) -> Value {
    json_ok(
        home,
        &["--project", "Demo", "epic", "show", "FILE-SHARE", "--json"],
    )["epic"]["waves"]
        .clone()
}

#[test]
fn epic_edit_waves_before_json_stores_the_waves_and_prints_json() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_with_four_tasks(home.path());

    let edited = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "FILE-SHARE",
            "--waves",
            "1",
            "2,3",
            "--json",
        ],
    );
    assert_eq!(edited["epic"]["waves"], serde_json::json!([[1], [2, 3]]));
    assert_eq!(waves_of(home.path()), serde_json::json!([[1], [2, 3]]));

    let single = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "FILE-SHARE",
            "--waves",
            "4",
            "--json",
        ],
    );
    assert_eq!(single["epic"]["waves"], serde_json::json!([[4]]));
}

#[test]
fn epic_edit_waves_works_in_any_order_with_the_other_options() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_with_four_tasks(home.path());
    let document = home.path().join("document.md");
    std::fs::write(&document, "---\n---\n\nBody text.\n").unwrap();
    let path = document.to_str().unwrap();

    let orders: [Vec<&str>; 3] = [
        vec![
            "--waves",
            "1,2",
            "3",
            "--document-file",
            path,
            "--name",
            "A",
        ],
        vec!["--document-file", path, "--name", "B", "--waves", "4", "3"],
        vec![
            "--name",
            "C",
            "--waves",
            "2",
            "1,3",
            "--document-file",
            path,
        ],
    ];
    let expected = [
        ("A", serde_json::json!([[1, 2], [3]])),
        ("B", serde_json::json!([[4], [3]])),
        ("C", serde_json::json!([[2], [1, 3]])),
    ];
    for (tail, (name, waves)) in orders.iter().zip(expected) {
        let mut args = vec!["--project", "Demo", "epic", "edit", "FILE-SHARE"];
        args.extend(tail);
        args.push("--json");
        let edited = json_ok(home.path(), &args);
        assert_eq!(edited["epic"]["name"], name);
        assert_eq!(edited["epic"]["waves"], waves);
        assert!(
            edited["epic"]["document"]
                .as_str()
                .unwrap()
                .contains("Body text.")
        );
    }
}

#[test]
fn epic_edit_empty_waves_clears_the_order_with_or_without_later_flags() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_with_four_tasks(home.path());
    let set = [
        "--project",
        "Demo",
        "epic",
        "edit",
        "FILE-SHARE",
        "--waves",
        "1",
        "2",
    ];
    let (code, _, err) = agboard(home.path(), &set);
    assert_eq!(code, 0, "{err}");
    assert_eq!(waves_of(home.path()), serde_json::json!([[1], [2]]));

    let cleared = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "FILE-SHARE",
            "--waves",
            "",
            "--json",
        ],
    );
    assert_eq!(cleared["epic"]["waves"], serde_json::json!([]));

    let (code, _, err) = agboard(home.path(), &set);
    assert_eq!(code, 0, "{err}");
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "FILE-SHARE",
            "--waves",
            "",
        ],
    );
    assert_eq!(code, 0, "{err}");
    assert_eq!(waves_of(home.path()), serde_json::json!([]));
}
