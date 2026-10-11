//! Build-time embedded monitor and access asset manifests.

mod monitor_manifest {
    include!(concat!(env!("OUT_DIR"), "/monitor_assets_table.rs"));
}

/// Public monitor entry HTML.
pub const MONITOR_HTML: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/web/dist/monitor/index.html"
));
/// Dedicated monitor entry script.
pub const MONITOR_JS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/web/dist/monitor/monitor.js"
));
/// Dedicated monitor stylesheet.
pub const MONITOR_CSS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/web/dist/monitor/monitor.css"
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

/// Exact-name lookup for the independent monitor manifest.
pub fn monitor_lookup(name: &str) -> Option<(&'static [u8], &'static str)> {
    lookup(monitor_manifest::ASSETS, name)
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
    fn lookups_only_return_registered_single_level_assets() {
        assert!(monitor_lookup("monitor.js").is_some());
        assert!(monitor_lookup("../monitor.js").is_none());
        assert!(monitor_lookup("app.js").is_none());
        assert!(access_lookup("entry.js").is_some());
        assert!(access_lookup("folder/entry.js").is_none());
    }
}
