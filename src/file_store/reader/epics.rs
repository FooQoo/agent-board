//! Reading every epic folder of a project.

use super::files::{parse_file, problem_of};
use std::fs;
use std::path::{Path, PathBuf};

use crate::file_store::frontmatter;
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::{EpicFile, EpicView, Problem};
use crate::file_store::validate;

/// Read every epic folder. An epic whose `epic.json` is defective is left out
/// and reported in `problems`; its folder is never changed. A defect in
/// EPIC.md is reported while the document text is still returned.
pub(in crate::file_store) fn read_epics(
    shared: &Path,
    project_dir: &Path,
) -> (Vec<EpicView>, Vec<Problem>) {
    let mut epics = Vec::new();
    let mut problems = Vec::new();
    let Ok(entries) = fs::read_dir(layout::epics_dir(project_dir)) else {
        return (epics, problems);
    };
    let mut folders: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_owned();
            (!name.starts_with('.') && entry.path().is_dir()).then(|| (name, entry.path()))
        })
        .collect();
    folders.sort();
    for (name, folder) in folders {
        let json_path = folder.join("epic.json");
        let json_label = layout::shared_label(shared, &json_path);
        let file: EpicFile = match io::read_bytes(&json_path, &json_label)
            .and_then(|bytes| parse_file::<EpicFile>(&bytes, &json_label))
        {
            Ok(file) => file,
            Err(error) => {
                problems.push(problem_of(error));
                continue;
            }
        };
        let defects = validate::check_epic(&file, &name);
        if !defects.is_empty() {
            problems.extend(defects.into_iter().map(|d| Problem {
                file: json_label.clone(),
                field: d.field,
                reason: d.reason,
            }));
            continue;
        }
        let document_path = folder.join("EPIC.md");
        let document_label = layout::shared_label(shared, &document_path);
        let document = match io::read_text(&document_path, &document_label) {
            Ok(text) => {
                problems.extend(validate::check_document_body(&text).into_iter().map(|d| {
                    Problem {
                        file: document_label.clone(),
                        field: d.field,
                        reason: d.reason,
                    }
                }));
                text
            }
            Err(error) => {
                problems.push(problem_of(error));
                String::new()
            }
        };
        let parts = frontmatter::parse_document(&document);
        let (priority, priority_error) = match frontmatter::priority_of(&document) {
            Ok(order) => (order, false),
            Err(_) => (Vec::new(), true),
        };
        epics.push(EpicView {
            id: file.id,
            name: file.name,
            color: file.color,
            is_draft: file.is_draft,
            document,
            body: parts.body,
            priority,
            priority_error,
            attachments: file.attachments,
            created_at: file.created_at,
            updated_at: file.updated_at,
        });
    }
    (epics, problems)
}
