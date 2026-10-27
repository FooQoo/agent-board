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
    /// The listable entries of `dir` at `depth`, by name. The root's
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
    // By name alone, folders and files mixed, so a numbered prefix such as
    // `01_` orders both.
    entries.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

/// A Markdown file's exact text and its revision.
/// The BOM, if any, stays in `content`.
pub fn read_file(root: &DocsRoot, path: &DocsPath) -> Result<DocsFile, DocsError> {
    let label = path.as_string();
    let bytes = read_limited(root, path, MAX_FILE_BYTES)?;
    let content = String::from_utf8(bytes).map_err(|_| DocsError::DocsNotUtf8 {
        path: label.clone(),
    })?;
    let revision = revision_of(content.as_bytes());
    Ok(DocsFile {
        path: label,
        content,
        revision,
    })
}

/// The `Content-Type` of an SVG, which the asset route serves with a restrictive policy.
pub const SVG_TYPE: &str = "image/svg+xml";

/// The fixed `Content-Type` of an image extension, or `None` for any other.
fn image_type(extension: Option<&str>) -> Option<&'static str> {
    match extension {
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("webp") => Some("image/webp"),
        Some("gif") => Some("image/gif"),
        Some("avif") => Some("image/avif"),
        Some("svg") => Some(SVG_TYPE),
        _ => None,
    }
}

/// How the Docs show a file, by its extension.
fn viewer_of(extension: Option<&str>) -> Viewer {
    if matches!(extension, Some("md" | "mdx")) {
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
    let bytes = read_limited(root, path, MAX_ASSET_BYTES)?;
    Ok((bytes, content_type))
}

/// The whole file if it is at most `limit` bytes.
fn read_limited(root: &DocsRoot, path: &DocsPath, limit: u64) -> Result<Vec<u8>, DocsError> {
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
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tree_is_in_order_of_name_with_folders_and_files_mixed() {
        let dir = tempfile::tempdir().unwrap();
        let root_dir = dir.path();
        for folder in ["02_business", "04_design", "Zeta"] {
            fs::create_dir_all(root_dir.join(folder)).unwrap();
        }
        for file in ["03_ISSUE.mdx", "01_PRODUCT.mdx", "00_README.md", "alpha.md"] {
            fs::write(root_dir.join(file), "x").unwrap();
        }
        fs::write(root_dir.join("02_business/01_STRATEGY.mdx"), "x").unwrap();
        fs::write(root_dir.join("02_business/00_README.md"), "x").unwrap();

        let tree = read_tree(&DocsRoot::at(root_dir)).unwrap();
        let names: Vec<&str> = tree.nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "00_README.md",
                "01_PRODUCT.mdx",
                "02_business",
                "03_ISSUE.mdx",
                "04_design",
                "alpha.md",
                "Zeta",
            ]
        );
        let business: Vec<&str> = tree.nodes[2]
            .children
            .as_ref()
            .unwrap()
            .iter()
            .map(|n| n.name.as_str())
            .collect();
        assert_eq!(business, ["00_README.md", "01_STRATEGY.mdx"]);
    }
}
