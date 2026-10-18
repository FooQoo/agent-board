//! Build-time embedded monitor and access assets. The monitor's scripts and
//! stylesheets are in [`crate::server::web_assets`], in a table of their own.

use crate::server::web_assets::{
    self, BUILD_ID_PLACEHOLDER, EmbeddedAsset, MONITOR_ASSETS, MONITOR_BUILD_ID,
};

/// Public monitor entry HTML, with the token and build ID placeholders.
pub const MONITOR_HTML: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/web/dist/monitor/index.html"
));
/// Shared access entry HTML.
pub const ACCESS_HTML: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/web/dist/access/index.html"
));
/// Shared access redirect script.
pub const ACCESS_JS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/web/dist/access/entry.js"
));

/// The monitor page with its token and the monitor's build ID filled in.
pub fn render_monitor(token: &str) -> String {
    MONITOR_HTML
        .replace("{{AGBOARD_MONITOR_TOKEN}}", token)
        .replace(BUILD_ID_PLACEHOLDER, MONITOR_BUILD_ID)
}

/// Exact-name lookup in the monitor's own table: the board's files are not
/// there, except chunks the monitor build reuses byte for byte.
pub fn monitor_lookup(name: &str) -> Option<&'static EmbeddedAsset> {
    web_assets::find(MONITOR_ASSETS, name)
}

/// Exact-name lookup for the independent access manifest.
pub fn access_lookup(name: &str) -> Option<(&'static [u8], &'static str)> {
    lookup(access_manifest::ASSETS, name)
}

fn lookup(
    assets: &'static [(&'static str, &'static str, &'static [u8])],
    name: &str,
) -> Option<(&'static [u8], &'static str)> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return None;
    }
    assets
        .iter()
        .find(|(known, _, _)| *known == name)
        .map(|(_, mime, bytes)| (*bytes, *mime))
}

mod access_manifest {
    include!(concat!(env!("OUT_DIR"), "/access_assets_table.rs"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_monitor_page_gets_its_token_and_build_id_and_no_board_files() {
        let html = render_monitor("t0ken");
        assert!(html.contains(r#"name="agboard-monitor-token" content="t0ken""#));
        assert!(html.contains(&format!(
            r#"name="agboard-build" content="{MONITOR_BUILD_ID}""#
        )));
        assert!(!html.contains("{{"));
        assert!(
            MONITOR_ASSETS
                .iter()
                .all(|asset| !asset.name.starts_with("app-"))
        );
    }

    #[test]
    fn lookups_only_return_registered_single_level_assets() {
        let entry = MONITOR_ASSETS
            .iter()
            .find(|asset| asset.name.starts_with("monitor-"))
            .expect("the monitor has a content-named entry");
        assert!(monitor_lookup(entry.name).is_some());
        assert!(monitor_lookup(&format!("../{}", entry.name)).is_none());
        assert!(monitor_lookup("index.html").is_none());
        assert!(monitor_lookup("app.js").is_none());
        assert!(access_lookup("entry.js").is_some());
        assert!(access_lookup("folder/entry.js").is_none());
    }
}
