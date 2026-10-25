use agent_board::server::monitor;
use agent_board::server::web_assets::{APP_ASSETS, MONITOR_ASSETS};

#[test]
fn monitor_assets_are_embedded_and_have_their_own_lookup_boundary() {
    assert!(!monitor::assets::MONITOR_HTML.is_empty());
    for prefix in ["monitor-"] {
        for extension in [".js", ".css"] {
            let entry = MONITOR_ASSETS
                .iter()
                .find(|asset| asset.name.starts_with(prefix) && asset.name.ends_with(extension))
                .expect("the monitor has content-named entry files");
            assert!(monitor::assets::monitor_lookup(entry.name).is_some());
        }
    }
    assert!(monitor::assets::monitor_lookup("index.html").is_none());
    assert!(monitor::assets::monitor_lookup("../assets/app.js").is_none());
    for board in APP_ASSETS
        .iter()
        .filter(|asset| asset.name.starts_with("app-"))
    {
        assert!(
            monitor::assets::monitor_lookup(board.name).is_none(),
            "{}",
            board.name
        );
    }
}

#[test]
fn monitor_html_contains_only_runtime_placeholders() {
    let html = monitor::assets::MONITOR_HTML;
    assert!(html.contains("name=\"agboard-monitor-token\" content=\"{{AGBOARD_MONITOR_TOKEN}}\""));
    assert!(html.contains("name=\"agboard-build\" content=\"{{AGBOARD_BUILD_ID}}\""));
    assert!(!html.contains("name=\"agboard-token\""));
    assert!(!html.contains("/assets/app"));
    assert!(html.contains("/monitor/assets/monitor/monitor-"));
}
