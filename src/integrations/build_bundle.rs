//! Writes `integration_bundle.rs`, the Skill and Hook files that connect and
//! update install. Included by `build.rs` with a `#[path]` attribute, as
//! `src/server/dist.rs` is; it is not part of the library. The standard
//! library only, so the build script compiles without this crate.
//!
//! Sources come from an allowlist: `SKILL.md`, the Markdown files in the
//! Skill's `references/` and `assets/`, and the two Hook templates. A linked
//! or empty source, a machine-specific path, or a Skill reference that is not
//! embedded stops the build.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// Writes `integration_bundle.rs` into `out_dir`.
pub fn write(manifest_dir: &Path, out_dir: &Path) {
    let skill = manifest_dir.join(".agents/skills/agent-board");
    println!("cargo:rerun-if-changed={}", skill.display());
    if !skill.is_dir() {
        // A crate root without the Skill sources, such as the build-script
        // fixtures, embeds nothing. A real checkout always has them.
        println!(
            "cargo:warning=no Skill sources under {}; the bundle is empty",
            skill.display()
        );
        let empty = "pub static INTEGRATION_FILES: &[(&str, &[u8])] = &[];\n";
        std::fs::write(out_dir.join("integration_bundle.rs"), empty)
            .expect("the build script can write to OUT_DIR");
        return;
    }
    let hooks = manifest_dir.join("integrations");
    let mut files: BTreeMap<String, PathBuf> = BTreeMap::new();
    files.insert(
        "hooks/claude.json".into(),
        hooks.join("claude-code/settings.json"),
    );
    files.insert("hooks/codex.json".into(), hooks.join("codex/hooks.json"));
    files.insert("skill/SKILL.md".into(), skill.join("SKILL.md"));
    for folder in ["references", "assets"] {
        let dir = skill.join(folder);
        let items = std::fs::read_dir(&dir)
            .unwrap_or_else(|_| fail(format!("error: {} is missing.", dir.display())));
        for item in items.filter_map(Result::ok) {
            let name = item.file_name().to_string_lossy().into_owned();
            if name.ends_with(".md") {
                files.insert(format!("skill/{folder}/{name}"), dir.join(&name));
            }
        }
    }
    let mut source = String::from("pub static INTEGRATION_FILES: &[(&str, &[u8])] = &[\n");
    for (name, path) in &files {
        let bytes = std::fs::read(path).unwrap_or_default();
        let linked = std::fs::symlink_metadata(path).map_or(true, |m| m.is_symlink());
        let text = String::from_utf8_lossy(&bytes);
        if linked || bytes.is_empty() || text.contains("/Users/") || text.contains("/home/") {
            fail(format!(
                "error: {} is missing, linked, or not portable.",
                path.display()
            ));
        }
        for folder in ["references/", "assets/"] {
            for (at, _) in text.match_indices(folder) {
                let rest = &text[at..];
                let token: String = rest
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || "/._-".contains(*c))
                    .collect();
                let embedded = files.contains_key(&format!("skill/{token}"));
                if name.starts_with("skill/") && token.contains('.') && !embedded {
                    fail(format!(
                        "error: {} refers to {token}, which is not embedded.",
                        path.display()
                    ));
                }
            }
        }
        println!("cargo:rerun-if-changed={}", path.display());
        let include = path.display().to_string();
        writeln!(
            source,
            "    ({name:?}, include_bytes!({include:?}) as &[u8]),"
        )
        .unwrap();
    }
    source.push_str("];\n");
    std::fs::write(out_dir.join("integration_bundle.rs"), source)
        .expect("the build script can write to OUT_DIR");
    println!("cargo:rerun-if-changed={}", skill.display());
}

/// Stops the build with `message`.
fn fail(message: String) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}
