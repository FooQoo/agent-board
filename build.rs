//! Stops the build when the web UI has not been built, because the server
//! embeds `web/dist/` with `include_str!`. Also writes the table of on-demand
//! web chunks (`web/dist/assets/app-*.js`) that `GET /assets/{name}` serves.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

#[path = "src/server/dist.rs"]
mod dist;

fn main() {
    let manifest_dir = PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo sets CARGO_MANIFEST_DIR"),
    );
    let dist_dir = manifest_dir.join("web/dist");
    let missing = dist::missing_files(&dist_dir);
    if !missing.is_empty() {
        eprintln!("{}", dist::error_message(&missing));
        std::process::exit(1);
    }

    for (namespace, required) in [
        ("access", dist::ACCESS_REQUIRED_FILES.as_slice()),
        ("monitor", dist::MONITOR_REQUIRED_FILES.as_slice()),
    ] {
        let absent = dist::missing_namespace_files(&dist_dir, namespace, required);
        if !absent.is_empty() {
            eprintln!("{}", dist::namespace_error_message(namespace, &absent));
            std::process::exit(1);
        }
    }

    // The chunk table is generated from the folder, so a folder that is not
    // there is an error: an empty table would silently serve no chunk.
    let assets = dist_dir.join("assets");
    if !assets.is_dir() {
        eprintln!(
            "{} is missing. Run \"pnpm --dir web build\" first.",
            assets.display()
        );
        std::process::exit(1);
    }
    let names = chunk_names(&assets);

    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR"));
    let table = chunk_table(&names);
    std::fs::write(out_dir.join("assets_table.rs"), table)
        .expect("the build script can write to OUT_DIR");

    std::fs::write(
        out_dir.join("access_assets_table.rs"),
        isolated_asset_table("access", &dist::ACCESS_REQUIRED_FILES),
    )
    .expect("the build script can write to OUT_DIR");
    let mut monitor_names = dist::MONITOR_REQUIRED_FILES
        .iter()
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    let monitor_dir = dist_dir.join("monitor");
    monitor_names.extend(
        std::fs::read_dir(&monitor_dir)
            .expect("required monitor directory exists")
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_file())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("viewer-") && name.ends_with(".js")),
    );
    monitor_names.sort();
    monitor_names.dedup();
    std::fs::write(
        out_dir.join("monitor_assets_table.rs"),
        isolated_asset_table(
            "monitor",
            &monitor_names.iter().map(String::as_str).collect::<Vec<_>>(),
        ),
    )
    .expect("the build script can write to OUT_DIR");

    // Rerun when the folder gains or loses a file, and when any listed chunk
    // changes, so the table never outlives the files it names.
    println!("cargo:rerun-if-changed=web/dist");
    println!("cargo:rerun-if-changed=web/dist/assets");
    println!("cargo:rerun-if-changed=web/dist/access");
    println!("cargo:rerun-if-changed=web/dist/monitor");
    for name in &names {
        println!("cargo:rerun-if-changed=web/dist/assets/{name}");
    }
}

/// Rust source for an isolated asset manifest with exact name, MIME and bytes.
fn isolated_asset_table(namespace: &str, names: &[&str]) -> String {
    let mut source = String::from("pub static ASSETS: &[(&str, &str, &[u8])] = &[\n");
    for name in names {
        let mime = match Path::new(name).extension().and_then(|ext| ext.to_str()) {
            Some("html") => "text/html; charset=utf-8",
            Some("js") => "text/javascript; charset=utf-8",
            Some("css") => "text/css; charset=utf-8",
            _ => "application/octet-stream",
        };
        writeln!(
            source,
            "    ({name:?}, {mime:?}, include_bytes!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/web/dist/{namespace}/{name}\")) as &[u8]),"
        )
        .unwrap();
        println!("cargo:rerun-if-changed=web/dist/{namespace}/{name}");
    }
    source.push_str("];\n");
    source
}

/// The names of the on-demand chunks in `assets`, sorted.
fn chunk_names(assets: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(assets) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_file())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("app-") && name.ends_with(".js"))
        .collect();
    names.sort();
    names
}

/// Rust source for `ASSET_CHUNKS`, a `(name, bytes)` table of every chunk.
/// The bytes are embedded with `include_bytes!`, so an empty table is valid
/// when the folder exists and has no chunks.
fn chunk_table(names: &[String]) -> String {
    let mut source = String::from(
        "/// Generated by build.rs: the on-demand web chunks, by file name.\n\
         pub static ASSET_CHUNKS: &[(&str, &[u8])] = &[\n",
    );
    for name in names {
        writeln!(
            source,
            "    ({name:?}, include_bytes!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/web/dist/assets/{name}\")) as &[u8]),"
        )
        .unwrap();
    }
    source.push_str("];\n");
    source
}
