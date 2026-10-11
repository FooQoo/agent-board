//! Project creation and the project-level reads of the shared file store.
//! Covers the files an empty data area gets and the refusal of unknown fields, unsupported versions, and mismatched IDs.

use std::fs;
use std::path::Path;

use agent_board::domain::ProjectId;
use agent_board::error::SkanError;
use agent_board::file_store::FileStore;
use chrono::{TimeZone, Utc};

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 4, 0, 0, 0).unwrap()
}

/// A data root with an empty `shared/` below it, and the store on that folder.
fn store() -> (tempfile::TempDir, FileStore) {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    (root, FileStore::open(&shared))
}

fn read_json(path: &Path) -> serde_json::Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn an_empty_data_area_gets_workspace_project_and_readme() {
    let (root, store) = store();
    let project = store.create_project("Alpha", now()).unwrap();

    let shared = root.path().join("shared");
    assert_eq!(
        read_json(&shared.join("workspace.json")),
        serde_json::json!({"format": "agboard-files", "formatVersion": 1})
    );
    let dir = shared.join("projects").join(project.id.as_str());
    let project_json = read_json(&dir.join("project.json"));
    assert_eq!(project_json["formatVersion"], 1);
    assert_eq!(project_json["id"], project.id.as_str());
    assert_eq!(project_json["name"], "Alpha");
    assert_eq!(project_json["createdAt"], "2026-10-04T00:00:00Z");
    assert_eq!(project_json["nextCardId"], 1);
    let readme = fs::read_to_string(dir.join("README.md")).unwrap();
    // The guidance for people and agents who touch the files directly (U9-6).
    for rule in [
        "Do not edit TASK.md of a card that is a draft.",
        "Do not edit it; use the `agboard` CLI.",
        "Do not delete a card folder or an epic folder.",
    ] {
        assert!(readme.contains(rule), "README lacks {rule:?}");
    }
    assert!(dir.join("tasks").is_dir());
    assert!(dir.join("epics").is_dir());

    let entries: Vec<String> = fs::read_dir(root.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(entries, vec!["shared"], "only the shared folder");
}

#[test]
fn project_names_are_trimmed_unique_and_case_sensitive_and_listed_by_name() {
    let (_root, store) = store();
    let beta = store.create_project("Beta", now()).unwrap();
    let alpha = store.create_project("  Alpha  ", now()).unwrap();
    assert_eq!(alpha.name, "Alpha");

    let duplicate = store.create_project("Alpha", now()).unwrap_err();
    assert!(matches!(duplicate, SkanError::ProjectNameExists { .. }));
    assert!(store.create_project("alpha", now()).is_ok());

    let names: Vec<String> = store
        .projects()
        .unwrap()
        .into_iter()
        .map(|p| p.name)
        .collect();
    assert_eq!(names, vec!["Alpha", "Beta", "alpha"]);
    assert!(store.projects().unwrap().iter().any(|p| p.id == beta.id));
}

#[test]
fn concurrent_creations_of_one_name_admit_exactly_one() {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let shared = shared.clone();
            std::thread::spawn(move || FileStore::open(&shared).create_project("Same", now()))
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    let created = results.iter().filter(|r| r.is_ok()).count();
    let refused = results
        .iter()
        .filter(|r| matches!(r, Err(SkanError::ProjectNameExists { .. })))
        .count();
    assert_eq!(created, 1);
    assert_eq!(refused, 3);
    assert_eq!(FileStore::open(&shared).projects().unwrap().len(), 1);
}

#[test]
fn a_workspace_with_another_format_version_is_refused_and_not_converted() {
    let (root, store) = store();
    let shared = root.path().join("shared");
    fs::create_dir_all(&shared).unwrap();
    let path = shared.join("workspace.json");
    let text = "{\n  \"format\": \"agboard-files\",\n  \"formatVersion\": 2\n}\n";
    fs::write(&path, text).unwrap();

    let err = store.projects().unwrap_err();
    assert!(
        matches!(err, SkanError::FormatUnsupported { .. }),
        "{err:?}"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
}

#[test]
fn a_project_file_with_unknown_fields_is_refused_as_a_whole() {
    let (root, store) = store();
    let project = store.create_project("Alpha", now()).unwrap();
    let path = root
        .path()
        .join("shared/projects")
        .join(project.id.as_str())
        .join("project.json");
    let mut json = read_json(&path);
    json["extra"] = serde_json::json!(true);
    fs::write(&path, serde_json::to_string_pretty(&json).unwrap()).unwrap();

    match store.snapshot(&project.id).unwrap_err() {
        SkanError::FileInvalid { file, field, .. } => {
            assert_eq!(field, "extra");
            assert_eq!(
                file,
                format!("projects/{}/project.json", project.id.as_str())
            );
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn a_project_file_of_another_format_version_is_refused_and_unchanged() {
    let (root, store) = store();
    let project = store.create_project("Alpha", now()).unwrap();
    let path = root
        .path()
        .join("shared/projects")
        .join(project.id.as_str())
        .join("project.json");
    let mut json = read_json(&path);
    json["formatVersion"] = serde_json::json!(2);
    let text = serde_json::to_string_pretty(&json).unwrap();
    fs::write(&path, &text).unwrap();

    let err = store.snapshot(&project.id).unwrap_err();
    assert!(
        matches!(err, SkanError::FormatUnsupported { .. }),
        "{err:?}"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
}

#[test]
fn a_project_whose_id_does_not_match_its_folder_is_refused() {
    let (root, store) = store();
    let project = store.create_project("Alpha", now()).unwrap();
    let path = root
        .path()
        .join("shared/projects")
        .join(project.id.as_str())
        .join("project.json");
    let mut json = read_json(&path);
    json["id"] = serde_json::json!("ffffffffffffffffffffffffffffffff");
    fs::write(&path, serde_json::to_string_pretty(&json).unwrap()).unwrap();

    match store.snapshot(&project.id).unwrap_err() {
        SkanError::FileInvalid { field, .. } => assert_eq!(field, "id"),
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn a_missing_project_is_project_not_found() {
    let (_root, store) = store();
    let id: ProjectId = "0123456789abcdef0123456789abcdef".parse().unwrap();
    assert!(matches!(
        store.snapshot(&id),
        Err(SkanError::ProjectNotFound { .. })
    ));
}

#[test]
fn a_snapshot_of_an_empty_project_has_no_cards_and_no_problems() {
    let (_root, store) = store();
    let project = store.create_project("Alpha", now()).unwrap();
    let snapshot = store.snapshot(&project.id).unwrap();
    assert_eq!(snapshot.project.name, "Alpha");
    assert_eq!(snapshot.next_card_id, 1);
    assert!(snapshot.cards.is_empty());
    assert!(snapshot.problems.is_empty());
}
