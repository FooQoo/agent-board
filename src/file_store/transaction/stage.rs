//! Injection points for storage tests, and the hooked replacement of one file.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use crate::error::AgboardError;
use crate::file_store::io::{random_hex, sync_dir, write_error};

/// Injection points used by storage tests. Hooks are ordinary Rust arguments;
/// they have no environment-variable, file, or CLI configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    PrepareDirectorySync,
    PrepareWrite,
    PrepareFileSync,
    PrepareRename,
    PrepareDirectoryCommit,
    MetadataWrite,
    MetadataFileSync,
    MetadataRename,
    MetadataDirectorySync,
    MarkdownWrite,
    MarkdownFileSync,
    MarkdownRename,
    MarkdownDirectorySync,
    CommitWrite,
    CommitFileSync,
    CommitRename,
    CommitDirectorySync,
    Cleanup,
    CleanupDirectorySync,
    RecoveryMetadataWrite,
    RecoveryMetadataSync,
    RecoveryMetadataRename,
    RecoveryMetadataDirectorySync,
    RecoveryMarkdownWrite,
    RecoveryMarkdownSync,
    RecoveryMarkdownRename,
    RecoveryMarkdownDirectorySync,
}

impl Stage {
    pub const SAVE_STAGES: &'static [Stage] = &[
        Self::PrepareDirectorySync,
        Self::PrepareWrite,
        Self::PrepareFileSync,
        Self::PrepareRename,
        Self::PrepareDirectoryCommit,
        Self::MetadataWrite,
        Self::MetadataFileSync,
        Self::MetadataRename,
        Self::MetadataDirectorySync,
        Self::MarkdownWrite,
        Self::MarkdownFileSync,
        Self::MarkdownRename,
        Self::MarkdownDirectorySync,
        Self::CommitWrite,
        Self::CommitFileSync,
        Self::CommitRename,
        Self::CommitDirectorySync,
        Self::Cleanup,
        Self::CleanupDirectorySync,
    ];

    pub fn is_after_commit(self) -> bool {
        matches!(self, Self::Cleanup | Self::CleanupDirectorySync)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fault {
    /// A reported I/O failure: save rolls back before returning an error.
    Fail,
    /// Simulated process interruption: leave the journal for the next entry.
    Interrupt,
}

pub(super) type Hook<'a> = dyn FnMut(Stage) -> Result<(), Fault> + 'a;

pub(super) fn point(
    hook: &mut Hook<'_>,
    stage: Stage,
    interrupted: &mut bool,
) -> Result<(), AgboardError> {
    hook(stage).map_err(|fault| {
        *interrupted = fault == Fault::Interrupt;
        write_error(
            ".internal/transactions",
            format!("Injected {fault:?} at {stage:?}."),
        )
    })
}

pub(super) fn replace(
    path: &Path,
    bytes: &[u8],
    stages: [Stage; 4],
    hook: &mut Hook<'_>,
    interrupted: &mut bool,
) -> Result<(), AgboardError> {
    let parent = path.parent().expect("validated target parent");
    let temp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name()
            .expect("validated filename")
            .to_string_lossy(),
        random_hex(8).map_err(|e| write_error(".internal/transactions", e))?
    ));
    let result = (|| {
        point(hook, stages[0], interrupted)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| write_error(".internal/transactions", e))?;
        file.write_all(bytes)
            .map_err(|e| write_error(".internal/transactions", e))?;
        point(hook, stages[1], interrupted)?;
        file.sync_all()
            .map_err(|e| write_error(".internal/transactions", e))?;
        drop(file);
        point(hook, stages[2], interrupted)?;
        fs::rename(&temp, path).map_err(|e| write_error(".internal/transactions", e))?;
        point(hook, stages[3], interrupted)?;
        sync_dir(parent).map_err(|e| write_error(".internal/transactions", e))
    })();
    if result.is_err() && !*interrupted {
        let _ = fs::remove_file(&temp);
    }
    result
}
