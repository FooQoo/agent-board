//! Stops the build when the web UI has not been built, because the server
//! embeds `web/dist/` with `include_str!`.

use std::path::PathBuf;

#[path = "src/server/dist.rs"]
mod dist;

fn main() {
    let manifest_dir = PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo sets CARGO_MANIFEST_DIR"),
    );
    let missing = dist::missing_files(&manifest_dir.join("web/dist"));
    if !missing.is_empty() {
        eprintln!("{}", dist::error_message(&missing));
        std::process::exit(1);
    }
    println!("cargo:rerun-if-changed=web/dist");
}
