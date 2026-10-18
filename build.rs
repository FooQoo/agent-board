//! Stops the build when the web UI has not been built, because the server
//! embeds `web/dist/`. Writes the tables of embedded web files:
//!
//! - `web_assets.rs`: the board's and the monitor's scripts and stylesheets,
//!   as the gzip files the web build writes beside them, with a build ID for
//!   each page. Files are named by their content, and a file both builds
//!   contain is embedded once.
//! - `access_assets_table.rs`: the remote access page's files, as they are.
//!
//! The script uses the standard library only: the tests compile it alone.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

#[path = "src/server/dist.rs"]
mod dist;

fn main() {
    let manifest_dir = PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo sets CARGO_MANIFEST_DIR"),
    );
    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR"));
    let dist_dir = manifest_dir.join("web/dist");
    let missing = dist::missing_files(&dist_dir);
    if !missing.is_empty() {
        fail(&dist::error_message(&missing));
    }
    for (namespace, required) in [
        ("access", dist::ACCESS_REQUIRED_FILES.as_slice()),
        ("monitor", dist::MONITOR_REQUIRED_FILES.as_slice()),
    ] {
        let absent = dist::missing_namespace_files(&dist_dir, namespace, required);
        if !absent.is_empty() {
            fail(&dist::namespace_error_message(namespace, &absent));
        }
    }

    let mut blobs = Blobs::default();
    let app = Page::read(&dist_dir, "assets", "app", &mut blobs);
    let monitor = Page::read(&dist_dir, "monitor", "monitor", &mut blobs);

    let mut source = String::new();
    blobs.write_statics(&mut source);
    app.write_table(&mut source, "APP");
    monitor.write_table(&mut source, "MONITOR");
    std::fs::write(out_dir.join("web_assets.rs"), source)
        .expect("the build script can write to OUT_DIR");

    std::fs::write(
        out_dir.join("access_assets_table.rs"),
        access_table(&dist::ACCESS_REQUIRED_FILES),
    )
    .expect("the build script can write to OUT_DIR");

    // Rerun when a folder gains or loses a file; every listed file is also
    // watched, so the tables never outlive the files they name.
    for folder in ["", "/assets", "/access", "/monitor"] {
        println!("cargo:rerun-if-changed=web/dist{folder}");
    }
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

/// One page's build: its content-named files and its build ID.
struct Page {
    /// File name to the name of the static that holds its gzip bytes.
    files: BTreeMap<String, String>,
    build_id: String,
}

impl Page {
    /// Reads `web/dist/<folder>`: the page's HTML template (`index.html` at the
    /// top of `web/dist` for the board) and every `<entry>-*` and `chunk-*`
    /// script or stylesheet with its `.gz`. Fails when a `.gz` is missing or
    /// when the HTML loads a file that is not there.
    fn read(dist: &Path, folder: &str, entry: &str, blobs: &mut Blobs) -> Self {
        let (html_path, url_prefix) = if folder == "assets" {
            (dist.join("index.html"), "/assets/".to_owned())
        } else {
            (
                dist.join(folder).join("index.html"),
                format!("/assets/{folder}/"),
            )
        };
        let html = std::fs::read_to_string(&html_path).expect("the HTML template is readable");
        let dir = dist.join(folder);
        let mut files = BTreeMap::new();
        let mut names: Vec<String> = std::fs::read_dir(&dir)
            .expect("the asset folder is readable")
            .filter_map(Result::ok)
            .filter(|item| item.path().is_file())
            .map(|item| item.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(&format!("{entry}-")) || name.starts_with("chunk-"))
            .filter(|name| mime_of(name).is_some())
            .collect();
        names.sort();
        for name in names {
            let gz = dir.join(format!("{name}.gz"));
            let Ok(bytes) = std::fs::read(&gz) else {
                fail(&format!(
                    "error: {} is missing.\nRun \"pnpm --dir web build\" first.",
                    gz.display()
                ));
            };
            println!("cargo:rerun-if-changed={}", gz.display());
            files.insert(name, blobs.add(&gz, bytes));
        }

        let referenced = references(&html, &url_prefix);
        let absent: Vec<&str> = referenced
            .iter()
            .filter(|name| !files.contains_key(**name))
            .copied()
            .collect();
        if referenced.is_empty() || !absent.is_empty() {
            fail(&format!(
                "error: {} loads files that are not built ({}).\nRun \"pnpm --dir web build\" first.",
                html_path.display(),
                absent.join(", ")
            ));
        }

        // The HTML names every entry by its content, and the entries name the
        // chunks, so the template alone identifies the build; the file names
        // are added in case a chunk changes without its importer.
        let mut identity = html.into_bytes();
        for name in files.keys() {
            identity.extend_from_slice(format!("\0{name}").as_bytes());
        }
        let build_id = format!("{:016x}", fnv1a(&identity));
        Self { files, build_id }
    }

    fn write_table(&self, source: &mut String, prefix: &str) {
        writeln!(
            source,
            "pub const {prefix}_BUILD_ID: &str = {:?};",
            self.build_id
        )
        .unwrap();
        writeln!(source, "pub static {prefix}_ASSETS: &[EmbeddedAsset] = &[").unwrap();
        for (name, blob) in &self.files {
            let mime = mime_of(name).expect("only scripts and stylesheets are listed");
            writeln!(
                source,
                "    EmbeddedAsset {{ name: {name:?}, mime: {mime:?}, gzip: {blob} }},"
            )
            .unwrap();
        }
        source.push_str("];\n");
    }
}

/// The distinct gzip files: a file with the same bytes as an earlier one
/// reuses its static, so it is embedded once.
#[derive(Default)]
struct Blobs {
    /// The bytes of each embedded file and its path, by content hash.
    by_hash: BTreeMap<u64, Vec<(Vec<u8>, PathBuf)>>,
}

impl Blobs {
    /// The name of the static holding `bytes`, read from `path`.
    fn add(&mut self, path: &Path, bytes: Vec<u8>) -> String {
        let hash = fnv1a(&bytes);
        let same = self.by_hash.entry(hash).or_default();
        let index = match same.iter().position(|(known, _)| *known == bytes) {
            Some(index) => index,
            None => {
                same.push((bytes, path.to_owned()));
                same.len() - 1
            }
        };
        Self::static_name(hash, index)
    }

    fn static_name(hash: u64, index: usize) -> String {
        format!("GZ_{hash:016X}_{index}")
    }

    fn write_statics(&self, source: &mut String) {
        for (hash, files) in &self.by_hash {
            for (index, (_, path)) in files.iter().enumerate() {
                writeln!(
                    source,
                    "static {}: &[u8] = include_bytes!({:?});",
                    Self::static_name(*hash, index),
                    path.display().to_string()
                )
                .unwrap();
            }
        }
    }
}

/// 64-bit FNV-1a: a stable hash that needs no crate.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// The file names the HTML loads from `url_prefix`, e.g. `app-x.js` from
/// `"/assets/app-x.js"`. Names below a further folder are not this page's.
fn references<'a>(html: &'a str, url_prefix: &str) -> Vec<&'a str> {
    let quoted = format!("\"{url_prefix}");
    html.match_indices(&quoted)
        .filter_map(|(at, _)| {
            let rest = &html[at + quoted.len()..];
            let end = rest.find(['"', '?'])?;
            Some(&rest[..end])
        })
        .filter(|name| !name.contains('/'))
        .collect()
}

fn mime_of(name: &str) -> Option<&'static str> {
    match Path::new(name).extension().and_then(|ext| ext.to_str()) {
        Some("js") => Some("text/javascript; charset=utf-8"),
        Some("css") => Some("text/css; charset=utf-8"),
        _ => None,
    }
}

/// Rust source for the access page's manifest: exact name, MIME and bytes.
fn access_table(names: &[&str]) -> String {
    let mut source = String::from("pub static ASSETS: &[(&str, &str, &[u8])] = &[\n");
    for name in names {
        let mime = match Path::new(name).extension().and_then(|ext| ext.to_str()) {
            Some("html") => "text/html; charset=utf-8",
            _ => mime_of(name).unwrap_or("application/octet-stream"),
        };
        writeln!(
            source,
            "    ({name:?}, {mime:?}, include_bytes!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/web/dist/access/{name}\")) as &[u8]),"
        )
        .unwrap();
        println!("cargo:rerun-if-changed=web/dist/access/{name}");
    }
    source.push_str("];\n");
    source
}
