//! Reading the Docs: the tree, a file and an image. The routes call these.

use std::fs::{self, File};
use std::io::{ErrorKind, Read};
use std::path::Path;

use super::model::{DocsError, DocsFile, DocsRoot, DocsTree, DocsTreeNode, NodeKind, Viewer};
use super::paths::DocsPath;
use super::{MAX_FILE_BYTES, MAX_TREE_DEPTH, MAX_TREE_ENTRIES, revision_of};
use crate::file_store::io::read_error;

/// The largest image the Docs serve: 10 MiB, apart from the file limit.
pub const MAX_ASSET_BYTES: u64 = 10 * 1024 * 1024;

/// The tree of folders and files under the root, names only. A missing
/// root is an empty tree; a folder that cannot be read is left out.
pub fn read_tree(root: &DocsRoot) -> Result<DocsTree, DocsError> {
    match fs::symlink_metadata(root.dir()) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return Ok(empty_tree()),
        Err(error) if matches!(error.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory) => {
            return Ok(empty_tree());
        }
        Err(error) => return Err(read_error("docs", error)),
    }
    let mut walk = Walk {
        count: 0,
        truncated: false,
    };
    let nodes = walk
        .list(root.dir(), "", 1)
        .map_err(|error| read_error("docs", error))?;
    Ok(DocsTree {
        nodes,
        truncated: walk.truncated,
    })
}

fn empty_tree() -> DocsTree {
    DocsTree {
        nodes: Vec::new(),
        truncated: false,
    }
}

struct Walk {
    count: usize,
    truncated: bool,
}

struct Entry {
    name: String,
    path: String,
    kind: NodeKind,
    viewer: Option<Viewer>,
}

impl Walk {
    /// The listable entries of `dir` at `depth`, folders first. The root's
    /// own read error is returned; a nested folder that fails is skipped.
    fn list(
        &mut self,
        dir: &Path,
        prefix: &str,
        depth: usize,
    ) -> std::io::Result<Vec<DocsTreeNode>> {
        let entries = listable(dir, prefix)?;
        let mut nodes = Vec::new();
        for entry in entries {
            if self.count >= MAX_TREE_ENTRIES {
                self.truncated = true;
                break;
            }
            match entry.kind {
                NodeKind::File => {
                    self.count += 1;
                    nodes.push(node(entry, None));
                }
                NodeKind::Dir => {
                    let child_dir = dir.join(&entry.name);
                    let children = if depth >= MAX_TREE_DEPTH {
                        // Its children would be one level too deep.
                        match listable(&child_dir, &entry.path) {
                            Ok(found) => {
                                self.truncated |= !found.is_empty();
                                Vec::new()
                            }
                            Err(_) => continue,
                        }
                    } else {
                        match self.list(&child_dir, &entry.path, depth + 1) {
                            Ok(children) => children,
                            Err(_) => continue,
                        }
                    };
                    self.count += 1;
                    nodes.push(node(entry, Some(children)));
                }
            }
        }
        Ok(nodes)
    }
}

fn node(entry: Entry, children: Option<Vec<DocsTreeNode>>) -> DocsTreeNode {
    DocsTreeNode {
        name: entry.name,
        path: entry.path,
        kind: entry.kind,
        viewer: entry.viewer,
        children,
    }
}

/// The folders and files directly in `dir`: no dot names, no links, only
/// names a [`DocsPath`] accepts. Folders first, then by name ignoring case.
fn listable(dir: &Path, prefix: &str) -> std::io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for item in fs::read_dir(dir)? {
        let Ok(item) = item else { continue };
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        let Ok(name) = item.file_name().into_string() else {
            continue;
        };
        let kind = if file_type.is_dir() {
            NodeKind::Dir
        } else if file_type.is_file() {
            NodeKind::File
        } else {
            continue;
        };
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let Ok(parsed) = DocsPath::parse(&path) else {
            continue;
        };
        let viewer = (kind == NodeKind::File).then(|| viewer_of(parsed.extension().as_deref()));
        entries.push(Entry {
            name,
            path,
            kind,
            viewer,
        });
    }
    entries.sort_by(|a, b| {
        let rank = |kind: NodeKind| matches!(kind, NodeKind::File) as u8;
        rank(a.kind)
            .cmp(&rank(b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

/// A Markdown file's exact text, its revision, and whether it is read-only.
/// The BOM, if any, stays in `content`.
pub fn read_file(root: &DocsRoot, path: &DocsPath) -> Result<DocsFile, DocsError> {
    let label = path.as_string();
    let (bytes, read_only) = read_limited(root, path, MAX_FILE_BYTES)?;
    let content = String::from_utf8(bytes).map_err(|_| DocsError::DocsNotUtf8 {
        path: label.clone(),
    })?;
    let revision = revision_of(content.as_bytes());
    Ok(DocsFile {
        path: label,
        content,
        revision,
        read_only,
    })
}

/// The fixed `Content-Type` of an image extension, or `None` for any other.
fn image_type(extension: Option<&str>) -> Option<&'static str> {
    match extension {
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("webp") => Some("image/webp"),
        Some("gif") => Some("image/gif"),
        _ => None,
    }
}

/// How the Docs show a file, by its extension.
fn viewer_of(extension: Option<&str>) -> Viewer {
    if extension == Some("md") {
        Viewer::Markdown
    } else if image_type(extension).is_some() {
        Viewer::Image
    } else {
        Viewer::Other
    }
}

/// The image's bytes and its fixed `Content-Type`.
pub fn read_asset(root: &DocsRoot, path: &DocsPath) -> Result<(Vec<u8>, &'static str), DocsError> {
    let Some(content_type) = image_type(path.extension().as_deref()) else {
        return Err(DocsError::DocsAssetType {
            path: path.as_string(),
        });
    };
    let (bytes, _) = read_limited(root, path, MAX_ASSET_BYTES)?;
    Ok((bytes, content_type))
}

/// The whole file if it is at most `limit` bytes, and whether it is read-only.
fn read_limited(
    root: &DocsRoot,
    path: &DocsPath,
    limit: u64,
) -> Result<(Vec<u8>, bool), DocsError> {
    let label = path.as_string();
    let file = root.open_file(path)?;
    let meta = file.metadata().map_err(|error| read_error(&label, error))?;
    let too_large = || DocsError::DocsTooLarge {
        path: label.clone(),
        limit,
    };
    if meta.len() > limit {
        return Err(too_large());
    }
    let mut bytes = Vec::new();
    File::take(file, limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| read_error(&label, error))?;
    if bytes.len() as u64 > limit {
        return Err(too_large());
    }
    Ok((bytes, meta.permissions().readonly()))
}
