//! `ls --all-projects`: every project's board in one read-only fetch, with
//! each project's cards and history kept apart.

use std::ffi::OsString;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use agent_board::cli::{Context, Env};
use agent_board::clock::Clock;
use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewCard, ProjectId, RunState};
use agent_board::store::ProjectStore;
use assert_cmd::Command;
use chrono::{DateTime, TimeZone, Utc};
use serde_json::{Value, json};
use tempfile::tempdir;

// ---- helpers --------------------------------------------------------------

fn agboard(home: &Path, args: &[&str]) -> assert_cmd::assert::Assert {
    Command::cargo_bin("agboard")
        .unwrap()
        .env("SKAN_HOME", home)
        .env("TZ", "UTC")
        .args(args)
        .assert()
}

fn stdout_json(assert: assert_cmd::assert::Assert) -> Value {
    serde_json::from_slice(&assert.success().get_output().stdout).unwrap()
}

fn stdout_text(assert: assert_cmd::assert::Assert) -> String {
    String::from_utf8(assert.success().get_output().stdout.clone()).unwrap()
}

fn error_code(assert: assert_cmd::assert::Assert, exit: i32) -> String {
    let stderr = assert.failure().code(exit).get_output().stderr.clone();
    serde_json::from_slice::<Value>(&stderr).unwrap()["error"]["code"]
        .as_str()
        .unwrap()
        .to_string()
}

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 7, 1, 0, 0).unwrap()
}

fn ctx(actor: Actor, reason: &str) -> ChangeContext {
    ChangeContext {
        actor,
        reason: reason.into(),
    }
}

fn new_card(title: &str, assignee: Assignee) -> NewCard {
    NewCard {
        title: title.into(),
        description: format!("about {title}"),
        assignee,
        actor: Actor::Human,
    }
}

struct Fixed;
impl Clock for Fixed {
    fn now(&self) -> DateTime<Utc> {
        now()
    }
}

/// Two projects created in reverse name order, each with cards numbered 1 and
/// 2 but different content and history. Returns their IDs (Alpha, Beta).
fn two_projects(path: &Path) -> (ProjectId, ProjectId) {
    let store = ProjectStore::open(path).unwrap();
    let beta = store.create_project("Beta", now()).unwrap().id;
    let alpha = store.create_project("Alpha", now()).unwrap().id;
    store
        .add_work_card(&beta, new_card("beta task", Assignee::Ai), now())
        .unwrap();
    store
        .add_work_card(&beta, new_card("beta human", Assignee::Human), now())
        .unwrap();
    store
        .move_work_card(&beta, 1, Column::Doing, ctx(Actor::Ai, "start beta"), now())
        .unwrap();
    store
        .set_agent_status(
            &beta,
            1,
            RunState::Pending,
            ctx(Actor::Ai, "need a beta decision"),
            None,
            now(),
        )
        .unwrap();
    store
        .add_work_card(&alpha, new_card("alpha task", Assignee::Ai), now())
        .unwrap();
    store
        .add_work_card(&alpha, new_card("alpha human", Assignee::Human), now())
        .unwrap();
    store
        .move_work_card(&alpha, 2, Column::Done, ctx(Actor::Human, "done"), now())
        .unwrap();
    (alpha, beta)
}

fn all_json(home: &Path, extra: &[&str]) -> Value {
    let mut args = vec!["ls", "--all-projects", "--json"];
    args.extend(extra);
    stdout_json(agboard(home, &args))
}

fn snapshot_json(home: &Path, project: &str) -> Value {
    let mut snapshot = stdout_json(agboard(home, &["--project", project, "snapshot", "--json"]));
    snapshot.as_object_mut().unwrap().remove("fetchedAt");
    snapshot
}

fn files(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        // The write-ahead log files come and go with any connection.
        .filter(|n| !n.ends_with("-wal") && !n.ends_with("-shm"))
        .collect();
    names.sort();
    names
}

// ---- the store -------------------------------------------------------------

#[test]
fn the_store_reads_every_project_by_name_with_its_own_snapshot() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("board.db");
    let (alpha, beta) = two_projects(&path);
    let store = ProjectStore::open(&path).unwrap();

    let all = store.all_snapshots().unwrap();
    assert_eq!(
        all.catalog_revision,
        store.projects().unwrap().catalog_revision
    );
    let names: Vec<_> = all
        .projects
        .iter()
        .map(|p| p.project.name.as_str())
        .collect();
    assert_eq!(names, ["Alpha", "Beta"]);
    assert_eq!(all.projects[0], store.snapshot(&alpha).unwrap());
    assert_eq!(all.projects[1], store.snapshot(&beta).unwrap());
}

#[test]
fn the_same_card_numbers_in_two_projects_stay_separate() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("board.db");
    let (_, _) = two_projects(&path);
    let all = ProjectStore::open(&path).unwrap().all_snapshots().unwrap();
    let (alpha, beta) = (&all.projects[0], &all.projects[1]);
    assert_eq!(alpha.cards[0].id, beta.cards[0].id);
    assert_eq!(alpha.cards[0].title, "alpha task");
    assert_eq!(beta.cards[0].title, "beta task");
    assert_eq!(alpha.cards[0].history.len(), 1);
    assert_eq!(beta.cards[0].history.len(), 3);
    assert!(
        beta.cards[0]
            .history
            .iter()
            .all(|e| e.reason.as_deref().is_none_or(|r| r.contains("beta")))
    );
    assert_eq!(
        alpha.cursor.to_string(),
        format!("{}:{}", alpha.project.id, alpha.revision)
    );
    assert_eq!(
        beta.cursor.to_string(),
        format!("{}:{}", beta.project.id, beta.revision)
    );
}

#[test]
fn the_store_returns_an_empty_list_for_no_projects() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("board.db");
    let store = ProjectStore::open(&path).unwrap();
    let all = store.all_snapshots().unwrap();
    assert!(all.projects.is_empty());
    assert_eq!(all.catalog_revision, 0);
    // Deleting the only project advances the catalog revision.
    let id = store.create_project("Gone", now()).unwrap().id;
    store.delete_project(&id).unwrap();
    let all = store.all_snapshots().unwrap();
    assert!(all.projects.is_empty());
    assert_eq!(
        all.catalog_revision,
        store.projects().unwrap().catalog_revision
    );
    assert!(all.catalog_revision > 0);
}

#[test]
fn the_store_is_sorted_by_binary_name_order() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("board.db");
    let store = ProjectStore::open(&path).unwrap();
    for name in ["b", "B", "a", "Z"] {
        store.create_project(name, now()).unwrap();
    }
    let all = store.all_snapshots().unwrap();
    let names: Vec<_> = all
        .projects
        .iter()
        .map(|p| p.project.name.as_str())
        .collect();
    assert_eq!(names, ["B", "Z", "a", "b"]);
}

#[test]
fn one_read_never_mixes_two_states_of_the_catalog() {
    // The writer always changes project A and then project B, so in any one
    // state A's revision is B's or one more. Reading the projects one after
    // another can break that; one read cannot.
    let dir = tempdir().unwrap();
    let path = dir.path().join("board.db");
    let (a, b) = {
        let store = ProjectStore::open(&path).unwrap();
        let a = store.create_project("A", now()).unwrap().id;
        let b = store.create_project("B", now()).unwrap().id;
        (a, b)
    };
    let stop = Arc::new(AtomicBool::new(false));
    let writer = {
        let (path, stop, a, b) = (path.clone(), Arc::clone(&stop), a.clone(), b.clone());
        std::thread::spawn(move || {
            let store = ProjectStore::open(&path).unwrap();
            let mut n = 0;
            while !stop.load(Ordering::SeqCst) && n < 400 {
                store
                    .add_work_card(&a, new_card(&format!("a{n}"), Assignee::Ai), now())
                    .unwrap();
                store
                    .add_work_card(&b, new_card(&format!("b{n}"), Assignee::Ai), now())
                    .unwrap();
                n += 1;
            }
        })
    };
    let store = ProjectStore::open(&path).unwrap();
    for _ in 0..300 {
        let all = store.all_snapshots().unwrap();
        let (pa, pb) = (&all.projects[0], &all.projects[1]);
        assert_eq!(pa.project.id, a);
        assert_eq!(pb.project.id, b);
        let gap = pa.revision - pb.revision;
        assert!(
            gap == 0 || gap == 1,
            "A at {} and B at {}",
            pa.revision,
            pb.revision
        );
        assert_eq!(pa.cards.len() as i64, pa.revision);
        assert_eq!(pb.cards.len() as i64, pb.revision);
    }
    stop.store(true, Ordering::SeqCst);
    writer.join().unwrap();
}

// ---- the JSON --------------------------------------------------------------

#[test]
fn json_lists_every_project_by_name_and_matches_each_snapshot() {
    let home = tempdir().unwrap();
    two_projects(&home.path().join("board.db"));
    let all = all_json(home.path(), &[]);

    let root: Vec<_> = all.as_object().unwrap().keys().cloned().collect();
    assert_eq!(root.len(), 3);
    for key in ["fetchedAt", "catalogRevision", "projects"] {
        assert!(root.contains(&key.to_string()), "{key}");
    }
    let fetched_at = all["fetchedAt"].as_str().unwrap();
    assert!(
        fetched_at.ends_with('Z') && fetched_at.contains('T'),
        "{fetched_at}"
    );

    let catalog = stdout_json(agboard(home.path(), &["project", "ls", "--json"]));
    assert_eq!(all["catalogRevision"], catalog["catalogRevision"]);

    let projects = all["projects"].as_array().unwrap();
    assert_eq!(projects.len(), 2);
    for (i, name) in ["Alpha", "Beta"].into_iter().enumerate() {
        assert_eq!(projects[i], snapshot_json(home.path(), name), "{name}");
        let p = &projects[i];
        for key in ["project", "revision", "cursor", "board", "cards"] {
            assert!(p.get(key).is_some(), "{name} lacks {key}");
        }
        assert!(p.get("fetchedAt").is_none());
        let id = p["project"]["id"].as_str().unwrap();
        assert_eq!(
            p["cursor"].as_str().unwrap(),
            format!("{id}:{}", p["revision"])
        );
    }
    // Same card number, different project, content and history.
    assert_eq!(projects[0]["cards"][0]["id"], projects[1]["cards"][0]["id"]);
    assert_eq!(projects[0]["cards"][0]["title"], "alpha task");
    assert_eq!(projects[1]["cards"][0]["title"], "beta task");
    assert_eq!(
        projects[1]["cards"][0]["history"].as_array().unwrap().len(),
        3
    );
}

#[test]
fn json_filters_apply_to_every_project_and_keep_empty_projects() {
    let home = tempdir().unwrap();
    two_projects(&home.path().join("board.db"));
    let titles = |value: &Value| -> Value {
        Value::Array(
            value["projects"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| {
                    json!({
                        "project": p["project"]["name"],
                        "cards": p["cards"].as_array().unwrap().iter().map(|c| c["title"].clone()).collect::<Vec<_>>(),
                    })
                })
                .collect(),
        )
    };

    let doing = all_json(home.path(), &["--column", "doing"]);
    assert_eq!(
        titles(&doing),
        json!([
            {"project": "Alpha", "cards": []},
            {"project": "Beta", "cards": ["beta task"]},
        ])
    );
    let pending = all_json(home.path(), &["--state", "pending"]);
    assert_eq!(
        titles(&pending),
        json!([
            {"project": "Alpha", "cards": []},
            {"project": "Beta", "cards": ["beta task"]},
        ])
    );
    let done = all_json(home.path(), &["--column", "done"]);
    assert_eq!(
        titles(&done),
        json!([
            {"project": "Alpha", "cards": ["alpha human"]},
            {"project": "Beta", "cards": []},
        ])
    );
    let both = all_json(home.path(), &["--column", "doing", "--state", "pending"]);
    assert_eq!(titles(&both), titles(&doing));
    let none = all_json(home.path(), &["--column", "doing", "--state", "running"]);
    assert_eq!(
        titles(&none),
        json!([{"project": "Alpha", "cards": []}, {"project": "Beta", "cards": []}])
    );
    // A filtered project keeps its whole snapshot except the dropped cards.
    let kept = &doing["projects"][1];
    let full = snapshot_json(home.path(), "Beta");
    assert_eq!(kept["revision"], full["revision"]);
    assert_eq!(kept["cursor"], full["cursor"]);
    assert_eq!(kept["board"], full["board"]);
    assert_eq!(kept["cards"][0], full["cards"][0]);
    assert_eq!(doing["catalogRevision"], full_catalog_revision(home.path()));
}

fn full_catalog_revision(home: &Path) -> Value {
    stdout_json(agboard(home, &["project", "ls", "--json"]))["catalogRevision"].clone()
}

// ---- the human output ------------------------------------------------------

#[test]
fn text_shows_a_heading_and_the_ls_layout_for_each_project() {
    let home = tempdir().unwrap();
    two_projects(&home.path().join("board.db"));
    let text = stdout_text(agboard(home.path(), &["ls", "--all-projects"]));
    let per_project = |name: &str| stdout_text(agboard(home.path(), &["--project", name, "ls"]));
    let expected = format!(
        "Project: Alpha\n{}\nProject: Beta\n{}",
        per_project("Alpha"),
        per_project("Beta")
    );
    assert_eq!(text, expected);
    assert!(text.contains("#1 beta task [AI] [pending: need a beta decision]"));
    assert!(!text.contains("History"), "no history in text");
    assert!(!text.contains("start beta"), "no history in text");

    // Filters keep every heading and column, with nothing under them.
    let filtered = stdout_text(agboard(
        home.path(),
        &["ls", "--all-projects", "--column", "doing"],
    ));
    assert_eq!(
        filtered,
        "Project: Alpha\nTodo\nDoing\nDone\n\nProject: Beta\nTodo\nDoing\n  #1 beta task [AI] [pending: need a beta decision]\nDone\n"
    );
}

#[test]
fn text_with_no_projects_points_to_project_create() {
    let home = tempdir().unwrap();
    let area = home.path().join("area");
    let empty = stdout_text(agboard(&area, &["ls", "--all-projects"]));
    assert_eq!(
        empty,
        stdout_text(agboard(&area, &["project", "ls"])),
        "the same guidance as project ls"
    );
    assert!(empty.contains("agboard project create"));

    // A data area that exists but holds no projects.
    ProjectStore::open(&home.path().join("board.db")).unwrap();
    let empty = stdout_text(agboard(home.path(), &["ls", "--all-projects"]));
    assert!(empty.contains("No projects."), "{empty}");
}

#[test]
fn help_shows_the_all_projects_example() {
    let home = tempdir().unwrap();
    for args in [&["--help"][..], &["ls", "--help"][..]] {
        let help = stdout_text(agboard(home.path(), args));
        assert!(
            help.contains("agboard ls --all-projects"),
            "{args:?}: {help}"
        );
    }
    let help = stdout_text(agboard(home.path(), &["ls", "--help"]));
    assert!(help.contains("--all-projects"));
}

// ---- read-only behaviour ---------------------------------------------------

#[test]
fn without_a_data_area_the_list_is_empty_and_nothing_is_created() {
    let home = tempdir().unwrap();
    let area = home.path().join("area");
    let all = all_json(&area, &[]);
    assert_eq!(all["projects"], json!([]));
    assert_eq!(all["catalogRevision"], 0);
    assert!(all["fetchedAt"].as_str().unwrap().ends_with('Z'));
    assert!(!area.exists(), "the data area was not created");
    // The filters change nothing for an empty list.
    assert_eq!(
        all_json(&area, &["--column", "done", "--state", "idle"])["projects"],
        json!([])
    );
    assert!(!area.exists());
}

#[test]
fn an_existing_area_without_projects_returns_its_real_revision() {
    let home = tempdir().unwrap();
    agboard(home.path(), &["project", "create", "Tmp"]).success();
    let store = ProjectStore::open(&home.path().join("board.db")).unwrap();
    let id = store.project_by_name("Tmp").unwrap().id;
    store.delete_project(&id).unwrap();
    let revision = full_catalog_revision(home.path());
    let all = all_json(home.path(), &[]);
    assert_eq!(all["projects"], json!([]));
    assert_eq!(all["catalogRevision"], revision);
    assert!(revision.as_i64().unwrap() > 0);
}

#[test]
fn reading_changes_neither_the_database_nor_the_files_nor_notifies() {
    let home = tempdir().unwrap();
    let db = home.path().join("board.db");
    two_projects(&db);
    let bytes = std::fs::read(&db).unwrap();
    let listing = files(home.path());

    for extra in [&[][..], &["--column", "doing"][..]] {
        all_json(home.path(), extra);
    }
    stdout_text(agboard(home.path(), &["ls", "--all-projects"]));
    assert_eq!(std::fs::read(&db).unwrap(), bytes);
    assert_eq!(files(home.path()), listing);

    // In process, with a spy where a notification would be sent.
    let args: Vec<OsString> = ["agboard", "ls", "--all-projects", "--json"]
        .into_iter()
        .map(OsString::from)
        .collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let mut calls = 0;
    let mut spy = |_: &Context, _: &Path| calls += 1;
    let mut env = Env {
        clock: Box::new(Fixed),
        db_path: db.clone(),
        stdout: &mut out,
        stderr: &mut err,
        after_commit: &mut spy,
    };
    assert_eq!(agent_board::cli::run_with(&args, &mut env), 0);
    assert_eq!(calls, 0, "no notification");
    let value: Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(value["fetchedAt"], "2026-10-07T01:00:00Z");
    assert_eq!(std::fs::read(&db).unwrap(), bytes);
}

#[test]
fn an_old_database_is_rejected_and_left_unchanged() {
    let home = tempdir().unwrap();
    let db = home.path().join("board.db");
    {
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE board (id INTEGER PRIMARY KEY, name TEXT); \
             INSERT INTO board VALUES (1, 'old'); PRAGMA user_version = 2;",
        )
        .unwrap();
    }
    let bytes = std::fs::read(&db).unwrap();
    let listing = files(home.path());
    assert_eq!(
        error_code(agboard(home.path(), &["ls", "--all-projects", "--json"]), 1),
        "database_error"
    );
    assert_eq!(std::fs::read(&db).unwrap(), bytes);
    assert_eq!(files(home.path()), listing);
}

// ---- argument checks -------------------------------------------------------

#[test]
fn all_projects_with_project_is_rejected_before_anything_is_read() {
    let home = tempdir().unwrap();
    let db = home.path().join("board.db");
    two_projects(&db);
    let bytes = std::fs::read(&db).unwrap();
    // Both orders of `--project`, the joined form, and with other options.
    for args in [
        vec!["--project", "Alpha", "ls", "--all-projects", "--json"],
        vec!["ls", "--all-projects", "--project", "Alpha", "--json"],
        vec!["ls", "--project", "Alpha", "--all-projects", "--json"],
        vec!["--project=Alpha", "ls", "--all-projects", "--json"],
        vec!["ls", "--all-projects", "--project=Alpha", "--json"],
        vec![
            "--project",
            "Alpha",
            "ls",
            "--all-projects",
            "--column",
            "doing",
            "--json",
        ],
        vec!["--project", "Nope", "ls", "--all-projects", "--json"],
    ] {
        assert_eq!(
            error_code(agboard(home.path(), &args), 2),
            "invalid_argument",
            "{args:?}"
        );
    }
    let out = agboard(home.path(), &["--project", "Alpha", "ls", "--all-projects"]);
    let stderr = String::from_utf8(out.failure().code(2).get_output().stderr.clone()).unwrap();
    assert!(
        stderr.contains("ls --all-projects does not take --project."),
        "{stderr}"
    );
    assert_eq!(std::fs::read(&db).unwrap(), bytes);
    // Without a data area nothing is created either.
    let area = home.path().join("area");
    assert_eq!(
        error_code(
            agboard(&area, &["--project", "A", "ls", "--all-projects", "--json"]),
            2
        ),
        "invalid_argument"
    );
    assert!(!area.exists());
}

#[test]
fn only_ls_accepts_all_projects() {
    let home = tempdir().unwrap();
    let db = home.path().join("board.db");
    two_projects(&db);
    let bytes = std::fs::read(&db).unwrap();
    let card = ["--assignee", "ai", "--actor", "ai"];
    let mut cases: Vec<Vec<&str>> = vec![
        vec![
            "--project",
            "Alpha",
            "show",
            "1",
            "--all-projects",
            "--json",
        ],
        vec!["--project", "Alpha", "snapshot", "--all-projects", "--json"],
        vec![
            "--project",
            "Alpha",
            "mv",
            "1",
            "doing",
            "--all-projects",
            "--actor",
            "ai",
            "--reason",
            "x",
            "--json",
        ],
        vec!["project", "ls", "--all-projects", "--json"],
        vec!["--all-projects", "ls", "--json"],
        vec!["--all-projects", "--json", "project", "ls"],
        vec!["serve", "--all-projects", "--json"],
        vec!["--project", "Alpha", "wait", "--all-projects", "--json"],
        vec!["--project", "Alpha", "hook", "--all-projects", "--json"],
    ];
    let mut add = vec!["--project", "Alpha", "add", "x", "--all-projects", "--json"];
    add.extend(card);
    cases.push(add);
    for args in cases {
        assert_eq!(
            error_code(agboard(home.path(), &args), 2),
            "invalid_argument",
            "{args:?}"
        );
    }
    assert_eq!(std::fs::read(&db).unwrap(), bytes);
}

#[test]
fn ls_without_all_projects_still_needs_one_project() {
    let home = tempdir().unwrap();
    two_projects(&home.path().join("board.db"));
    for args in [
        vec!["ls", "--json"],
        vec!["ls", "--column", "doing", "--json"],
        vec!["show", "1", "--json"],
        vec!["snapshot", "--json"],
        vec!["add", "x", "--assignee", "ai", "--actor", "ai", "--json"],
        vec![
            "mv", "1", "doing", "--actor", "ai", "--reason", "x", "--json",
        ],
    ] {
        assert_eq!(
            error_code(agboard(home.path(), &args), 2),
            "invalid_argument",
            "{args:?}"
        );
    }
    // The one-project forms are unchanged.
    let one = stdout_json(agboard(
        home.path(),
        &["--project", "Alpha", "ls", "--json"],
    ));
    assert_eq!(one["cards"].as_array().unwrap().len(), 2);
}
