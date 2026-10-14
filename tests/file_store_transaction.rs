use agent_board::file_store::transaction::{
    Fault, PairBytes, PairTargets, Stage, recover_locked, save_pair_locked,
    save_pair_with_hook_locked,
};
use std::{fs, path::PathBuf};

fn fixture() -> (tempfile::TempDir, PairTargets, PairBytes, PairBytes) {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join("tasks/1")).unwrap();
    let targets = PairTargets {
        metadata: PathBuf::from("tasks/1/task.json"),
        markdown: PathBuf::from("tasks/1/TASK.md"),
    };
    let old = PairBytes {
        metadata: b"old json".to_vec(),
        markdown: b"old md".to_vec(),
    };
    let new = PairBytes {
        metadata: b"new json".to_vec(),
        markdown: b"new md".to_vec(),
    };
    fs::write(root.path().join(&targets.metadata), &old.metadata).unwrap();
    fs::write(root.path().join(&targets.markdown), &old.markdown).unwrap();
    (root, targets, old, new)
}
fn assert_pair(root: &std::path::Path, targets: &PairTargets, bytes: &PairBytes) {
    assert_eq!(
        fs::read(root.join(&targets.metadata)).unwrap(),
        bytes.metadata
    );
    assert_eq!(
        fs::read(root.join(&targets.markdown)).unwrap(),
        bytes.markdown
    );
}

#[test]
fn pair_save_commits_and_cleanup_is_idempotent() {
    let (root, targets, old, new) = fixture();
    save_pair_locked(root.path(), &targets, &old, &new).unwrap();
    assert_pair(root.path(), &targets, &new);
    assert_eq!(recover_locked(root.path()).unwrap().recovered, 0);
}

#[test]
fn each_precommit_failure_rolls_back_and_each_postcommit_failure_keeps_new() {
    for stage in Stage::SAVE_STAGES {
        let (root, targets, old, new) = fixture();
        let result = save_pair_with_hook_locked(root.path(), &targets, &old, &new, |point| {
            if point == *stage {
                Err(Fault::Fail)
            } else {
                Ok(())
            }
        });
        if stage.is_after_commit() {
            assert!(result.is_ok(), "{stage:?}");
        } else {
            assert!(result.is_err(), "{stage:?}");
        }
        recover_locked(root.path()).unwrap();
        assert_pair(
            root.path(),
            &targets,
            if stage.is_after_commit() { &new } else { &old },
        );
    }
}

#[test]
fn interrupted_prepared_journal_recovers_old_and_committed_keeps_new() {
    for stage in [
        Stage::MetadataRename,
        Stage::MarkdownRename,
        Stage::CommitWrite,
        Stage::Cleanup,
    ] {
        let (root, targets, old, new) = fixture();
        assert!(
            save_pair_with_hook_locked(root.path(), &targets, &old, &new, |point| {
                if point == stage {
                    Err(Fault::Interrupt)
                } else {
                    Ok(())
                }
            })
            .is_err()
        );
        let result = recover_locked(root.path()).unwrap();
        assert_eq!(result.recovered, 1);
        assert_pair(
            root.path(),
            &targets,
            if stage.is_after_commit() { &new } else { &old },
        );
        assert_eq!(recover_locked(root.path()).unwrap().recovered, 0);
    }
}

#[test]
fn external_edits_are_not_overwritten_by_old_journal() {
    let (root, targets, old, new) = fixture();
    assert!(
        save_pair_with_hook_locked(root.path(), &targets, &old, &new, |stage| {
            if stage == Stage::MarkdownRename {
                Err(Fault::Interrupt)
            } else {
                Ok(())
            }
        })
        .is_err()
    );
    fs::write(root.path().join(&targets.markdown), b"external edit").unwrap();
    assert_eq!(
        recover_locked(root.path()).unwrap_err().code(),
        "file_error"
    );
    assert_eq!(
        fs::read(root.path().join(&targets.markdown)).unwrap(),
        b"external edit"
    );
    assert_eq!(
        fs::read(root.path().join(&targets.metadata)).unwrap(),
        new.metadata
    );
}

#[test]
fn target_paths_and_stale_expected_bytes_are_rejected_before_mutation() {
    for path in [
        "../task.json",
        "/tmp/task.json",
        "tasks/2/task.json",
        "tasks/1/other.json",
    ] {
        let (root, mut targets, old, new) = fixture();
        targets.metadata = path.into();
        assert!(save_pair_locked(root.path(), &targets, &old, &new).is_err());
        assert_eq!(
            fs::read(root.path().join("tasks/1/task.json")).unwrap(),
            old.metadata
        );
    }
    let (root, targets, mut old, new) = fixture();
    old.metadata = b"stale".to_vec();
    assert!(save_pair_locked(root.path(), &targets, &old, &new).is_err());
    assert_eq!(
        fs::read(root.path().join(&targets.metadata)).unwrap(),
        b"old json"
    );
}

#[cfg(unix)]
#[test]
fn symlinked_card_folder_cannot_escape_project() {
    let (root, targets, old, new) = fixture();
    let external = tempfile::tempdir().unwrap();
    fs::remove_dir_all(root.path().join("tasks/1")).unwrap();
    std::os::unix::fs::symlink(external.path(), root.path().join("tasks/1")).unwrap();
    assert!(save_pair_locked(root.path(), &targets, &old, &new).is_err());
    assert!(!external.path().join("task.json").exists());
}

#[test]
fn recovery_can_itself_be_interrupted_and_retried() {
    use agent_board::file_store::transaction::recover_with_hook_locked;
    for fault in [Fault::Fail, Fault::Interrupt] {
        for stage in [
            Stage::RecoveryMetadataWrite,
            Stage::RecoveryMetadataSync,
            Stage::RecoveryMetadataRename,
            Stage::RecoveryMetadataDirectorySync,
            Stage::RecoveryMarkdownWrite,
            Stage::RecoveryMarkdownSync,
            Stage::RecoveryMarkdownRename,
            Stage::RecoveryMarkdownDirectorySync,
            Stage::Cleanup,
            Stage::CleanupDirectorySync,
        ] {
            let (root, targets, old, new) = fixture();
            assert!(
                save_pair_with_hook_locked(root.path(), &targets, &old, &new, |point| {
                    if point == Stage::CommitWrite {
                        Err(Fault::Interrupt)
                    } else {
                        Ok(())
                    }
                })
                .is_err()
            );
            assert!(
                recover_with_hook_locked(root.path(), |point| {
                    if point == stage { Err(fault) } else { Ok(()) }
                })
                .is_err(),
                "{stage:?}"
            );
            recover_locked(root.path()).unwrap();
            assert_pair(root.path(), &targets, &old);
        }
    }
}

#[test]
fn corrupt_journal_content_or_hashes_and_committed_conflicts_block_recovery() {
    for change in ["hash", "path", "version", "json"] {
        let (root, targets, old, new) = fixture();
        assert!(
            save_pair_with_hook_locked(root.path(), &targets, &old, &new, |stage| {
                if stage == Stage::CommitWrite {
                    Err(Fault::Interrupt)
                } else {
                    Ok(())
                }
            })
            .is_err()
        );
        let path = fs::read_dir(root.path().join(".internal/transactions"))
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| path.extension().is_some_and(|ext| ext == "json"))
            .unwrap();
        let mut journal: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        match change {
            "hash" => journal["oldHashes"]["metadata"] = "invalid".into(),
            "path" => journal["targets"]["metadata"] = "../outside.json".into(),
            "version" => journal["formatVersion"] = 2.into(),
            _ => {}
        }
        fs::write(
            &path,
            if change == "json" {
                b"{".to_vec()
            } else {
                serde_json::to_vec(&journal).unwrap()
            },
        )
        .unwrap();
        assert_eq!(
            recover_locked(root.path()).unwrap_err().code(),
            "file_error"
        );
        assert_pair(root.path(), &targets, &new);
    }
    let (root, targets, old, new) = fixture();
    assert!(
        save_pair_with_hook_locked(root.path(), &targets, &old, &new, |stage| {
            if stage == Stage::Cleanup {
                Err(Fault::Interrupt)
            } else {
                Ok(())
            }
        })
        .is_err()
    );
    fs::write(root.path().join(&targets.metadata), b"external").unwrap();
    assert!(recover_locked(root.path()).is_err());
    assert_eq!(
        fs::read(root.path().join(&targets.metadata)).unwrap(),
        b"external"
    );
}

#[test]
fn interrupted_save_in_child_process_leaves_recoverable_journal() {
    for stage in ["metadata", "markdown", "commit", "cleanup"] {
        let (root, targets, old, new) = fixture();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "transaction_crash_child", "--nocapture"])
            .env("TRANSACTION_TEST_CHILD_ROOT", root.path())
            .env("TRANSACTION_TEST_CHILD_STAGE", stage)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(73));
        recover_locked(root.path()).unwrap();
        assert_pair(
            root.path(),
            &targets,
            if stage == "cleanup" { &new } else { &old },
        );
    }
}

// Executed only by the preceding test's private test-process harness. There is
// no crash switch in the production binary or the store's normal entry points.
#[test]
fn transaction_crash_child() {
    let Some(root) = std::env::var_os("TRANSACTION_TEST_CHILD_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let stage = match std::env::var("TRANSACTION_TEST_CHILD_STAGE")
        .unwrap()
        .as_str()
    {
        "metadata" => Stage::MetadataRename,
        "markdown" => Stage::MarkdownRename,
        "commit" => Stage::CommitWrite,
        "cleanup" => Stage::Cleanup,
        _ => panic!("unknown test checkpoint"),
    };
    let targets = PairTargets {
        metadata: "tasks/1/task.json".into(),
        markdown: "tasks/1/TASK.md".into(),
    };
    let old = PairBytes {
        metadata: b"old json".to_vec(),
        markdown: b"old md".to_vec(),
    };
    let new = PairBytes {
        metadata: b"new json".to_vec(),
        markdown: b"new md".to_vec(),
    };
    save_pair_with_hook_locked(&root, &targets, &old, &new, |point| {
        if point == stage {
            std::process::exit(73);
        }
        Ok(())
    })
    .unwrap();
    panic!("test process did not exit");
}
