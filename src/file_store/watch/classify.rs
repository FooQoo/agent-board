//! Which target a changed path below the shared folder belongs to.

use std::path::Path;
use std::str::FromStr;

use super::Target;
use crate::domain::ProjectId;

/// The target of one path below `shared`, or `None` when the path is not
/// canonical data: anything with a dot-prefixed name, `README.md` at the
/// project root, and paths outside `projects/`.
pub fn classify(shared: &Path, path: &Path) -> Option<Target> {
    let rest = path.strip_prefix(shared).ok()?;
    let parts: Vec<String> = rest
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if parts.iter().any(|part| part.starts_with('.')) {
        return None;
    }
    match parts.as_slice() {
        [name] if name == "workspace.json" || name == "projects" => Some(Target::All),
        [projects, id] if projects == "projects" => {
            ProjectId::from_str(id).ok().map(|_| Target::All)
        }
        // The Docs are the user's files: they are announced, not loaded as board data.
        [projects, id, docs, ..] if projects == "projects" && docs == "docs" => {
            ProjectId::from_str(id).ok().map(Target::Docs)
        }
        [projects, id, dir, ..] if projects == "projects" && dir == "notify" => {
            ProjectId::from_str(id).ok().map(Target::Notify)
        }
        [projects, _, file] if projects == "projects" && file == "README.md" => None,
        [projects, id, ..] if projects == "projects" => {
            ProjectId::from_str(id).ok().map(Target::Project)
        }
        _ => None,
    }
}
