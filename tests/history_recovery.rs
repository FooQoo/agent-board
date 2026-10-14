use std::fs;
use std::path::PathBuf;

use agent_board::domain::{Actor, Assignee, NewCard};
use agent_board::file_store::FileStore;
use agent_board::file_store::lock::WriteLock;
use agent_board::file_store::transaction::{
    Fault, PairBytes, PairTargets, Stage, save_pair_with_hook_locked,
};
use chrono::{TimeZone, Utc};

#[test]
fn public_snapshot_recovers_an_interrupted_pair_before_returning_a_card() {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let at = Utc.with_ymd_and_hms(2026, 10, 14, 0, 0, 0).unwrap();
    let project = store.create_project("Recovery", at).unwrap().id;
    store
        .create_card(
            &project,
            NewCard {
                title: "Original".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            at,
        )
        .unwrap();

    let project_dir = shared.join("projects").join(project.as_str());
    let card_dir = project_dir.join("tasks/1");
    let json_path = card_dir.join("task.json");
    let md_path = card_dir.join("TASK.md");
    let old = PairBytes {
        metadata: fs::read(&json_path).unwrap(),
        markdown: fs::read(&md_path).unwrap(),
    };
    let mut metadata: serde_json::Value = serde_json::from_slice(&old.metadata).unwrap();
    metadata["title"] = "Half-written".into();
    let mut next_metadata = serde_json::to_vec_pretty(&metadata).unwrap();
    next_metadata.push(b'\n');
    let mut next_markdown = old.markdown.clone();
    next_markdown.extend_from_slice(b"interrupted body edit\n");
    let targets = PairTargets {
        metadata: PathBuf::from("tasks/1/task.json"),
        markdown: PathBuf::from("tasks/1/TASK.md"),
    };

    let lock = WriteLock::acquire(&project_dir.join(".internal/write.lock")).unwrap();
    let interrupted = save_pair_with_hook_locked(
        &project_dir,
        &targets,
        &old,
        &PairBytes {
            metadata: next_metadata,
            markdown: next_markdown,
        },
        |stage| {
            if stage == Stage::MarkdownFileSync {
                Err(Fault::Interrupt)
            } else {
                Ok(())
            }
        },
    );
    assert!(interrupted.is_err());
    drop(lock);

    let snapshot = store.board(&project).unwrap();
    assert_eq!(snapshot.cards[0].title, "Original");
    assert_eq!(fs::read(&json_path).unwrap(), old.metadata);
    assert_eq!(fs::read(&md_path).unwrap(), old.markdown);
    assert!(
        fs::read_dir(project_dir.join(".internal/transactions"))
            .unwrap()
            .next()
            .is_none()
    );
}
