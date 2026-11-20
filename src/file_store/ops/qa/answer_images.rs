//! The images of an answer: written next to the question's own images before the reply is saved.

use crate::error::AgboardError;
use crate::file_store::qa::{self, Question};
use crate::file_store::{io, layout};

/// Whether `attachments/` holds a file with this name, ignoring letter case.
pub(super) fn existing_name(attachments: &std::path::Path, name: &str) -> bool {
    std::fs::read_dir(attachments).is_ok_and(|entries| {
        entries.flatten().any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(name)
        })
    })
}

/// Write the images of each answer into its question's `attachments/` folder. Each written
/// path is pushed to `placed`, so a later failure can remove them.
pub(super) fn place_images(
    project_dir: &std::path::Path,
    planned: &[(Question, Question)],
    staged: &[Vec<(String, &Vec<u8>)>],
    placed: &mut Vec<std::path::PathBuf>,
) -> Result<(), AgboardError> {
    for ((question, _), files) in planned.iter().zip(staged) {
        if files.is_empty() {
            continue;
        }
        let dir = qa::attachments_dir(&qa::message_dir(project_dir, &question.id));
        if layout::has_symlink_below(project_dir, &dir)
            .map_err(|e| io::write_error("attachments", e))?
        {
            return Err(io::write_error(
                "attachments",
                "a symbolic link is in the way",
            ));
        }
        std::fs::create_dir_all(&dir).map_err(|e| io::write_error("attachments", e))?;
        for (name, bytes) in files {
            let path = dir.join(name);
            io::write_atomic(&path, bytes, "attachments")?;
            placed.push(path);
        }
    }
    Ok(())
}

pub(super) fn remove_placed(placed: &[std::path::PathBuf]) {
    for path in placed {
        let _ = std::fs::remove_file(path);
    }
}
