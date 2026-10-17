//! The CLI for epics, epic membership, text evidence, and task images (AC-2
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
        "ai",
    ];
    if let Some(color) = color {
        args.extend(["--color", color]);
    }
    let (code, _, err) = agboard(home, &args);
    assert_eq!(code, 0, "epic add failed: {err}");
}

#[test]
fn epic_add_writes_the_epic_and_a_template_plan() {
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
    assert_eq!(shown["epic"]["isDraft"], false);
    let plan = shown["epic"]["plan"].as_str().unwrap();
    assert_eq!(plan, "", "plan lacks the template");
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
fn epic_edit_changes_the_name_the_color_and_the_plan_from_a_file() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "FILE-SHARE", "File share", Some("#111111"));
    let plan = home.path().join("plan.md");
    std::fs::write(
        &plan,
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
            "--plan-file",
            plan.to_str().unwrap(),
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
        shown["epic"]["plan"]
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
    assert_eq!(epics.len(), 2);
    assert_eq!(epics[0]["id"], "ALPHA");
    assert_eq!(epics[1]["id"], "FILE-SHARE");
    assert_eq!(epics[1]["name"], "File share");
    assert_eq!(epics[1]["color"], "#111111");
    assert_eq!(epics[1]["taskCount"], 1);
    assert_eq!(epics[0]["taskCount"], 0);
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
fn evidence_is_added_shown_and_its_removal_needs_a_person_at_a_terminal() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let log = home.path().join("run.log");
    std::fs::write(&log, "step 1 ok\nstep 2 ok\n").unwrap();

    let added = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "evidence",
            "add",
            "1",
            log.to_str().unwrap(),
            "--name",
            "run.log",
            "--json",
        ],
    );
    let evidence_id = added["evidence"]["id"].as_str().unwrap().to_string();
    assert_eq!(
        added["path"],
        format!("evidence/{evidence_id}.log").as_str()
    );

    let (code, out, err) = agboard(
        home.path(),
        &["--project", "Demo", "evidence", "show", "1", &evidence_id],
    );
    assert_eq!(code, 0, "{err}");
    assert_eq!(out, "step 1 ok\nstep 2 ok\n");

    let (code, code_name) = json_error(
        home.path(),
        &["--project", "Demo", "evidence", "rm", "1", &evidence_id],
    );
    assert_eq!((code, code_name.as_str()), (1, "confirmation_required"));
    let (code, out, _) = agboard(
        home.path(),
        &["--project", "Demo", "evidence", "show", "1", &evidence_id],
    );
    assert_eq!(code, 0);
    assert_eq!(out, "step 1 ok\nstep 2 ok\n", "the evidence is kept");
}

#[test]
fn evidence_must_be_utf8_text() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let bin = home.path().join("bin.dat");
    std::fs::write(&bin, [0xff, 0xfe, 0x00]).unwrap();
    let (code, code_name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "evidence",
            "add",
            "1",
            bin.to_str().unwrap(),
        ],
    );
    assert_eq!((code, code_name.as_str()), (2, "invalid_value"));
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
fn a_draft_task_refuses_cli_image_evidence_and_epic_changes_but_reads_still_work() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    epic_add(home.path(), "FILE-SHARE", "File share", Some("#111111"));
    let log = home.path().join("run.log");
    std::fs::write(&log, "ok").unwrap();
    let shot = home.path().join("shot.png");
    std::fs::write(&shot, png()).unwrap();
    let evidence = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "evidence",
            "add",
            "1",
            log.to_str().unwrap(),
            "--json",
        ],
    );
    let evidence_id = evidence["evidence"]["id"].as_str().unwrap().to_string();

    // A person marks the task as a draft through the Web path (the store API).
    let store = FileStore::open(&home.path().join("shared"));
    store
        .set_draft(&project_id(home.path()), 1, true, chrono::Utc::now())
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
    let (code, code_name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "evidence",
            "add",
            "1",
            log.to_str().unwrap(),
        ],
    );
    assert_eq!((code, code_name.as_str()), (1, "task_is_draft"));
    let (code, code_name) = json_error(
        home.path(),
        &["--project", "Demo", "evidence", "rm", "1", &evidence_id],
    );
    assert_eq!((code, code_name.as_str()), (1, "task_is_draft"));

    let shown = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    assert_eq!(shown["task"]["isDraft"], true);
    assert_eq!(shown["task"]["epicId"], Value::Null);
    let (code, _, err) = agboard(
        home.path(),
        &["--project", "Demo", "evidence", "show", "1", &evidence_id],
    );
    assert_eq!(code, 0, "{err}");
}
