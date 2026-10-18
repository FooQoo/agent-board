use agent_board::server::monitor;
use agent_board::server::web_assets::{APP_ASSETS, MONITOR_ASSETS};

#[test]
fn monitor_assets_are_embedded_and_have_their_own_lookup_boundary() {
    assert!(!monitor::assets::MONITOR_HTML.is_empty());
    assert!(!monitor::assets::ACCESS_HTML.is_empty());
    assert!(!monitor::assets::ACCESS_JS.is_empty());
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
    assert!(monitor::assets::access_lookup("entry.js").is_some());
    let (access_html, access_mime) = monitor::assets::access_lookup("index.html").unwrap();
    assert_eq!(access_mime, "text/html; charset=utf-8");
    assert_eq!(access_html, monitor::assets::ACCESS_HTML.as_bytes());
    assert!(monitor::assets::access_lookup("../assets/app.js").is_none());
}

#[test]
fn access_is_token_free_and_monitor_html_contains_only_runtime_placeholders() {
    assert!(!monitor::assets::ACCESS_HTML.contains("agboard-token"));
    let html = monitor::assets::MONITOR_HTML;
    assert!(html.contains("name=\"agboard-monitor-token\" content=\"{{AGBOARD_MONITOR_TOKEN}}\""));
    assert!(html.contains("name=\"agboard-build\" content=\"{{AGBOARD_BUILD_ID}}\""));
    assert!(!html.contains("name=\"agboard-token\""));
    assert!(!html.contains("/assets/app"));
    assert!(monitor::assets::ACCESS_HTML.contains("/assets/access/entry.js"));
    assert!(html.contains("/assets/monitor/monitor-"));
}
