use agent_board::server::{assets, monitor};

#[test]
fn monitor_assets_are_embedded_and_have_their_own_lookup_boundary() {
    assert!(!monitor::assets::MONITOR_HTML.is_empty());
    assert!(!monitor::assets::MONITOR_JS.is_empty());
    assert!(!monitor::assets::MONITOR_CSS.is_empty());
    assert!(!monitor::assets::ACCESS_HTML.is_empty());
    assert!(!monitor::assets::ACCESS_JS.is_empty());
    let (monitor_html, html_mime) = monitor::assets::monitor_lookup("index.html").unwrap();
    assert_eq!(html_mime, "text/html; charset=utf-8");
    assert_eq!(monitor_html, monitor::assets::MONITOR_HTML.as_bytes());
    assert!(monitor::assets::monitor_lookup("monitor.js").is_some());
    assert!(monitor::assets::monitor_lookup("monitor.css").is_some());
    assert!(monitor::assets::monitor_lookup("../assets/app.js").is_none());
    assert!(monitor::assets::monitor_lookup("app.js").is_none());
    assert!(monitor::assets::access_lookup("entry.js").is_some());
    let (access_html, access_mime) = monitor::assets::access_lookup("index.html").unwrap();
    assert_eq!(access_mime, "text/html; charset=utf-8");
    assert_eq!(access_html, monitor::assets::ACCESS_HTML.as_bytes());
    assert!(monitor::assets::access_lookup("../assets/app.js").is_none());
    assert!(assets::lookup("app-unlisted.js").is_none());
}

#[test]
fn access_and_monitor_html_are_public_and_token_free() {
    for html in [monitor::assets::ACCESS_HTML, monitor::assets::MONITOR_HTML] {
        assert!(!html.contains("agboard-token"));
        assert!(!html.contains("{{AGBOARD_TOKEN}}"));
        assert!(!html.contains("/assets/app.js"));
    }
    assert!(monitor::assets::ACCESS_HTML.contains("/assets/access/entry.js"));
    assert!(monitor::assets::MONITOR_HTML.contains("/assets/monitor/monitor.js"));
}
