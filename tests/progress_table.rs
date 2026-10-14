//! The progress table: which cards an agent can pick up, in what order, and
//! how an epic's priority list is stored in its PLAN.md. Runs the real CLI on
//! a temporary data area.

use std::fs;
use std::path::{Path, PathBuf};

use agent_board::file_store::frontmatter;
use assert_cmd::Command;
use serde_json::{Value, json};
use tempfile::{TempDir, tempdir};

fn agboard(home: &Path, args: &[&str]) -> assert_cmd::assert::Assert {
    Command::cargo_bin("agboard")
        .unwrap()
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .current_dir(home)
        .args(args)
        .assert()
}

fn ok_json(assert: assert_cmd::assert::Assert) -> Value {
    serde_json::from_slice(&assert.success().get_output().stdout).unwrap()
}

fn ok(assert: assert_cmd::assert::Assert) -> String {
    String::from_utf8(assert.success().get_output().stdout.clone()).unwrap()
}

/// A data area with project "Demo" bound to a folder of its own, and epic ALPHA.
fn demo() -> TempDir {
    let home = tempdir().unwrap();
    let folder = home.path().join("work");
    fs::create_dir_all(&folder).unwrap();
    let folder = folder.display().to_string();
    ok(agboard(
        home.path(),
        &["project", "create", "Demo", "--folder", &folder],
    ));
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "add",
            "ALPHA",
            "--name",
            "Alpha epic",
            "--actor",
            "ai",
        ],
    ));
    home
}

fn add(home: &Path, title: &str, epic: Option<&str>) -> i64 {
    let mut args = vec![
        "--project",
        "Demo",
        "add",
        title,
        "--assignee",
        "ai",
        "--actor",
        "ai",
        "--json",
    ];
    if let Some(epic) = epic {
        args.extend(["--epic", epic]);
    }
    ok_json(agboard(home, &args))["card"]["id"]
        .as_i64()
        .unwrap()
}

fn progress(home: &Path) -> Value {
    ok_json(agboard(home, &["--project", "Demo", "progress", "--json"]))
}

fn epic_card_ids(table: &Value, epic: &str) -> Vec<i64> {
    table["epics"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == epic)
        .map(|e| {
            e["cards"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| c["id"].as_i64().unwrap())
                .collect()
        })
        .unwrap_or_default()
}

fn plan_path(home: &Path) -> PathBuf {
    let table = progress(home);
    PathBuf::from(table["epics"][0]["planPath"].as_str().unwrap())
}

#[test]
fn priority_is_read_and_written_in_the_frontmatter_without_touching_the_body_or_other_keys() {
    let text = "---\nacceptance: []\nowner: team\npriority: [3, 1]\n---\n\nBody line\n";
    assert_eq!(frontmatter::priority_of(text).unwrap(), vec![3, 1]);
    assert!(frontmatter::priority_of("Plain body\n").unwrap().is_empty());

    let written = frontmatter::compose_priority(text, &[1, 3]).unwrap();
    assert!(written.contains("owner: team"));
    assert!(written.ends_with("\n---\n\nBody line\n"));
    assert_eq!(frontmatter::priority_of(&written).unwrap(), vec![1, 3]);

    let cleared = frontmatter::compose_priority(&written, &[]).unwrap();
    assert!(!cleared.contains("priority"));
    assert!(cleared.contains("owner: team"));
}

#[test]
fn a_priority_list_with_repeats_or_bad_entries_is_refused_and_a_stored_bad_one_is_reported() {
    assert!(frontmatter::compose_priority("", &[2, 2]).is_err());
    assert!(frontmatter::compose_priority("", &[0]).is_err());
    assert!(frontmatter::compose_priority("", &[-4]).is_err());
    assert!(frontmatter::priority_of("---\npriority: nope\n---\n").is_err());
    assert!(frontmatter::priority_of("---\npriority: [1, \"x\"]\n---\n").is_err());
    assert!(frontmatter::priority_of("---\npriority: [1, 1]\n---\n").is_err());
}

#[test]
fn the_progress_table_orders_epics_by_id_and_cards_by_priority_then_creation() {
    let home = demo();
    let first = add(home.path(), "first", Some("ALPHA"));
    let second = add(home.path(), "second", Some("ALPHA"));
    let third = add(home.path(), "third", Some("ALPHA"));
    let loose = add(home.path(), "loose", None);
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "ALPHA",
            "--priority",
            &format!("{third},{first}"),
        ],
    ));

    let table = progress(home.path());
    assert_eq!(epic_card_ids(&table, "ALPHA"), vec![third, first, second]);
    assert_eq!(table["unassigned"][0]["id"], loose);
    assert!(
        table["epics"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| !e["cards"].as_array().unwrap().is_empty())
    );
}

#[test]
fn epics_without_listed_cards_are_left_out_and_done_and_pending_cards_are_not_listed() {
    let home = demo();
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "add",
            "BETA",
            "--name",
            "Beta",
            "--actor",
            "ai",
        ],
    ));
    let kept = add(home.path(), "kept", Some("ALPHA"));
    let waiting = add(home.path(), "waiting", Some("ALPHA"));
    let finished = add(home.path(), "finished", Some("ALPHA"));
    let _beta = add(home.path(), "beta card", Some("BETA"));

    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            &waiting.to_string(),
            "doing",
            "--actor",
            "ai",
            "--reason",
            "start",
        ],
    ));
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            &waiting.to_string(),
            "pending",
            "--actor",
            "ai",
            "--request-json",
            r#"{"question":"Proceed?","choices":[{"id":"y","label":"Yes"},{"id":"n","label":"No"}]}"#,
        ],
    ));
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            &finished.to_string(),
            "done",
            "--actor",
            "human",
            "--reason",
            "done",
        ],
    ));

    let table = progress(home.path());
    let alpha = epic_card_ids(&table, "ALPHA");
    assert_eq!(alpha, vec![kept]);
    let ids: Vec<&str> = table["epics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["ALPHA", "BETA"]);
    assert!(table["unassigned"].as_array().unwrap().is_empty());
}

#[test]
fn a_pending_card_returns_to_the_table_once_it_is_idle_again() {
    let home = demo();
    let card = add(home.path(), "asks", Some("ALPHA"));
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            &card.to_string(),
            "doing",
            "--actor",
            "ai",
            "--reason",
            "start",
        ],
    ));
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            &card.to_string(),
            "pending",
            "--actor",
            "ai",
            "--request-json",
            r#"{"question":"Proceed?","choices":[{"id":"y","label":"Yes"},{"id":"n","label":"No"}]}"#,
        ],
    ));
    assert!(epic_card_ids(&progress(home.path()), "ALPHA").is_empty());
    let shown = ok_json(agboard(
        home.path(),
        &["--project", "Demo", "show", &card.to_string(), "--json"],
    ));
    let request = shown["card"]["pendingRequestId"]
        .as_str()
        .unwrap()
        .to_string();
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            &card.to_string(),
            "idle",
            "--actor",
            "human",
            "--reason",
            "answered",
            "--request",
            &request,
            "--choice",
            "y",
        ],
    ));
    assert_eq!(epic_card_ids(&progress(home.path()), "ALPHA"), vec![card]);
}

#[test]
fn the_json_has_paths_and_counts_but_no_body_or_history() {
    let home = demo();
    let card = add(home.path(), "shape", Some("ALPHA"));
    let table = progress(home.path());
    for key in [
        "project",
        "fetchedAt",
        "version",
        "cursor",
        "epics",
        "unassigned",
    ] {
        assert!(table.get(key).is_some(), "missing {key}");
    }
    let listed = &table["epics"][0]["cards"][0];
    assert_eq!(listed["id"], card);
    assert_eq!(listed["acceptance"], json!({"done": 0, "total": 0}));
    for forbidden in ["body", "description", "history", "attachments", "evidence"] {
        assert!(listed.get(forbidden).is_none(), "card carries {forbidden}");
        assert!(
            table["epics"][0].get(forbidden).is_none(),
            "epic carries {forbidden}"
        );
    }
    assert!(Path::new(listed["taskPath"].as_str().unwrap()).exists());
    assert!(plan_path(home.path()).exists());
}

#[test]
fn epic_edit_stores_the_order_without_the_body_drops_cards_that_left_and_refuses_repeats() {
    let home = demo();
    let kept = add(home.path(), "kept", Some("ALPHA"));
    let gone = add(home.path(), "gone", Some("ALPHA"));
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "ALPHA",
            "--plan",
            "# Plan\n\nKeep this text.\n",
        ],
    ));
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "ALPHA",
            "--priority",
            &format!("{gone},{kept},99"),
        ],
    ));
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "edit",
            &gone.to_string(),
            "--clear-epic",
        ],
    ));

    let stored = fs::read_to_string(plan_path(home.path())).unwrap();
    assert!(stored.contains("Keep this text."));
    // 99 belongs to no card and is dropped on save. The card that left keeps its place
    // in the stored order, but the table no longer shows it.
    assert_eq!(frontmatter::priority_of(&stored).unwrap(), vec![gone, kept]);
    assert_eq!(epic_card_ids(&progress(home.path()), "ALPHA"), vec![kept]);

    let refused = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "ALPHA",
            "--priority",
            "5,5",
            "--json",
        ],
    )
    .failure()
    .code(2)
    .get_output()
    .stderr
    .clone();
    assert!(String::from_utf8(refused).unwrap().contains("priority"));
}

#[test]
fn the_human_table_lists_each_epic_and_the_unassigned_cards() {
    let home = demo();
    add(home.path(), "inside", Some("ALPHA"));
    add(home.path(), "outside", None);
    let text = ok(agboard(home.path(), &["--project", "Demo", "progress"]));
    assert!(text.contains("ALPHA Alpha epic"));
    assert!(!text.contains("epic (acceptance"));
    assert!(text.contains("#1 inside [ai, todo, idle] acceptance 0/0"));
    assert!(text.contains("Unassigned"));
    assert!(text.contains("#2 outside"));
}

#[test]
fn an_archived_card_is_never_listed() {
    use agent_board::file_store::FileStore;
    let home = demo();
    let card = add(home.path(), "to archive", Some("ALPHA"));
    let kept = add(home.path(), "still open", Some("ALPHA"));
    ok(agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            &card.to_string(),
            "done",
            "--actor",
            "human",
            "--reason",
            "done",
        ],
    ));

    let store = FileStore::open(&home.path().join("shared"));
    let project = store
        .projects()
        .unwrap()
        .into_iter()
        .find(|p| p.name == "Demo")
        .unwrap();
    store
        .archive_card(&project.id, card, chrono::Utc::now())
        .unwrap();

    assert_eq!(epic_card_ids(&progress(home.path()), "ALPHA"), vec![kept]);
}
