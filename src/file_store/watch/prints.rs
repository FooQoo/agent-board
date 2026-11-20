//! What each project's `notify/` folder held the last time it was announced, so a full rescan
//! (after the platform lost events) announces a summary change once, and only for the projects
//! whose folder really changed.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::SystemTime;

use crate::domain::ProjectId;
use crate::file_store::notify::NOTIFY_DIR;

/// The names, sizes, and modification times of the files in one `notify/` folder.
type Print = Vec<(String, u64, Option<SystemTime>)>;

fn print_of(root: &Path, id: &ProjectId) -> Print {
    let Ok(entries) = fs::read_dir(root.join("projects").join(id.to_string()).join(NOTIFY_DIR))
    else {
        return Vec::new();
    };
    let mut print: Print = entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            Some((
                e.file_name().to_string_lossy().into_owned(),
                meta.len(),
                meta.modified().ok(),
            ))
        })
        .collect();
    print.sort();
    print
}

#[derive(Default)]
pub(super) struct NotifyPrints(HashMap<ProjectId, Print>);

impl NotifyPrints {
    /// Remember the folders as they are now, without announcing anything.
    pub(super) fn baseline(root: &Path) -> Self {
        let mut prints = Self::default();
        prints.changed_since(root);
        prints
    }

    /// An event named this project's folder: remember what it holds now.
    pub(super) fn seen(&mut self, root: &Path, id: &ProjectId) {
        self.0.insert(id.clone(), print_of(root, id));
    }

    /// The projects whose folder differs from what was last remembered, remembering the new state.
    pub(super) fn changed_since(&mut self, root: &Path) -> Vec<ProjectId> {
        let ids: Vec<ProjectId> = fs::read_dir(root.join("projects"))
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter_map(|e| e.file_name().to_string_lossy().parse().ok())
            .collect();
        let mut changed = Vec::new();
        for id in &ids {
            let now = print_of(root, id);
            let before = self.0.insert(id.clone(), now.clone());
            // A folder that is empty and was never seen has nothing to announce.
            if before.as_ref() != Some(&now) && !(before.is_none() && now.is_empty()) {
                changed.push(id.clone());
            }
        }
        self.0.retain(|id, _| ids.contains(id));
        changed
    }
}

#[cfg(test)]
mod tests;
