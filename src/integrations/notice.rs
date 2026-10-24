//! The quiet notice that installed integrations are older than this build.
//!
//! It only compares the `installedVersion` of the records update would
//! touch with the version of this build. It scans no asset, uses no network,
//! and writes nothing. Any problem (no registry, an unreadable or broken
//! registry, an unresolvable folder) means no notice: the command that was
//! run keeps its own output and exit code, and `agboard update` reports the
//! problem.

use std::cmp::Ordering;
use std::path::Path;

use super::paths::{PathEnv, registry_path};
use super::registry::Registry;
use super::update::{compare_versions, in_reach};
use crate::file_store::FileStore;

/// The one line to show on standard error, if the records in reach were
/// written by an older build than `current`.
pub fn stale_line(env: &PathEnv, shared_dir: &Path, cwd: &Path, current: &str) -> Option<String> {
    let registry = Registry::read(&registry_path(env).ok()?).ok()??;
    if registry.installations.is_empty() {
        return None;
    }
    let root = FileStore::open(shared_dir)
        .resolve_binding(cwd)
        .ok()
        .flatten()
        .map(|bound| bound.bound_root);
    let oldest = registry
        .installations
        .iter()
        .filter(|r| in_reach(r, root.as_deref()))
        .filter(|r| compare_versions(&r.installed_version, current) == Some(Ordering::Less))
        .min_by(|a, b| {
            compare_versions(&a.installed_version, &b.installed_version).unwrap_or(Ordering::Equal)
        })?;
    Some(format!(
        "Agent Board {current} is newer than the installed Skill and Hook ({}). Run \"agboard update\" to update them.",
        oldest.installed_version
    ))
}
