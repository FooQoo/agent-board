#[path = "support/mobile_monitor.rs"]
mod support;

use agent_board::server::web_assets::{APP_ASSETS, EmbeddedAsset, MONITOR_ASSETS};
use support::{ORIGIN, ORIGIN2, Running, home, monitor_token, token};

/// The name of the content-named entry script in `table`.
fn entry_script(table: &[EmbeddedAsset], prefix: &str) -> &'static str {
    table
        .iter()
        .find(|asset| asset.name.starts_with(prefix) && asset.name.ends_with(".js"))
        .expect("the build has an entry script")
        .name
}

#[test]
fn remote_entry_board_token_and_pc_write_guard_are_separate_from_local() {
    let home = home();
    let server = Running::start(home.path());
    let local_url = format!("http://127.0.0.1:{}/", server.local.port());
    let local_page = ureq::get(&local_url)
        .call()
        .unwrap()
        .body_mut()
        .read_to_string()
        .unwrap();
    let local_token = token(&local_page);

    let entry = server.request("GET", "/", &[("Host", "monitor.example")], "");
    assert_eq!(entry.status, 200);
    assert!(!entry.body.contains("agboard-token"));
    assert_eq!(entry.header("cache-control"), Some("no-store"));
    assert!(
        entry
            .header("content-security-policy")
            .unwrap()
            .contains("frame-ancestors 'none'")
    );

    let monitor = server.request("GET", "/monitor/", &[("Host", "monitor.example")], "");
    assert_eq!(monitor.status, 200);
    assert!(!monitor.body.contains("agboard-token"));
    let monitor_token = monitor_token(&monitor.body);
    assert_eq!(monitor_token.len(), 64);
    assert_ne!(monitor_token, local_token);
    assert!(monitor.body.contains(&monitor_token));

    let board = server.request("GET", "/board/", &[("Host", "monitor.example")], "");
    assert_eq!(board.status, 200);
    let remote_token = token(&board.body);
    assert_ne!(remote_token, local_token);
    assert!(board.body.contains(&remote_token));
    assert_eq!(
        server
            .request(
                "GET",
                &format!("/assets/{}", entry_script(APP_ASSETS, "app-")),
                &[("Host", "monitor.example")],
                ""
            )
            .status,
        200
    );
    assert_eq!(
        server
            .request(
                "GET",
                &format!(
                    "/assets/monitor/{}",
                    entry_script(MONITOR_ASSETS, "monitor-")
                ),
                &[("Host", "monitor.example")],
                ""
            )
            .status,
        200
    );
    assert_eq!(
        server
            .request("GET", "/", &[("Host", "tail.example:8443")], "")
            .status,
        200
    );

    let base = server.base(home.path());
    let create_body = r###"{"title":"Remote edit","description":"## 作業内容\n\nRemote edit\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Saved\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n","assignee":"ai"}"###;
    let good = server.request(
        "POST",
        &format!("{base}/tasks"),
        &[
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &remote_token),
            ("Content-Type", "application/json"),
        ],
        create_body,
    );
    assert_eq!(good.status, 201, "{}", good.body);
    let read = server.request(
        "GET",
        &format!("{base}/board"),
        &[("Host", "monitor.example")],
        "",
    );
    assert_eq!(read.status, 200);
    assert!(read.body.contains("Remote edit"));
    let monitor_read = server.request(
        "GET",
        &format!("{}/board", server.monitor_base(home.path())),
        &[("Host", "monitor.example")],
        "",
    );
    assert_eq!(monitor_read.status, 200);
    assert_eq!(monitor_read.body, read.body);
    let local_url = format!("http://127.0.0.1:{}{base}/board", server.local.port());
    let local_read = ureq::get(&local_url)
        .call()
        .unwrap()
        .body_mut()
        .read_to_string()
        .unwrap();
    assert_eq!(local_read, read.body);
    let second_origin = server.request(
        "POST",
        &format!("{base}/tasks"),
        &[
            ("Host", "tail.example:8443"),
            ("Origin", ORIGIN2),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &remote_token),
            ("Content-Type", "application/json"),
        ],
        create_body,
    );
    assert_eq!(second_origin.status, 201, "{}", second_origin.body);

    for headers in [
        vec![
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &local_token),
            ("Content-Type", "application/json"),
        ],
        vec![
            ("Host", "monitor.example"),
            ("Origin", "https://other.example"),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &remote_token),
            ("Content-Type", "application/json"),
        ],
        vec![
            ("Host", "unregistered.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &remote_token),
            ("Content-Type", "application/json"),
        ],
        vec![
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "cross-site"),
            ("X-Agboard-Token", &remote_token),
            ("Content-Type", "application/json"),
        ],
        vec![
            ("Host", "monitor.example"),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &remote_token),
            ("Content-Type", "application/json"),
        ],
        vec![
            ("Host", "monitor.example"),
            ("Origin", "null"),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &remote_token),
            ("Content-Type", "application/json"),
        ],
        vec![
            ("Host", "tail.example:8443"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &remote_token),
            ("Content-Type", "application/json"),
        ],
        vec![
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("Content-Type", "application/json"),
        ],
    ] {
        let before = server.request(
            "GET",
            &format!("{base}/board"),
            &[("Host", "monitor.example")],
            "",
        );
        let rejected = server.request("POST", &format!("{base}/tasks"), &headers, create_body);
        assert_eq!(rejected.status, 403, "{}", rejected.body);
        let after = server.request(
            "GET",
            &format!("{base}/board"),
            &[("Host", "monitor.example")],
            "",
        );
        assert_eq!(before.body, after.body);
    }

    let override_request = server.request(
        "POST",
        &format!("{base}/tasks"),
        &[
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &remote_token),
            ("X-HTTP-Method-Override", "DELETE"),
            ("Content-Type", "application/json"),
        ],
        create_body,
    );
    assert_eq!(override_request.status, 403);
    let forwarded = server.request(
        "POST",
        &format!("{base}/tasks"),
        &[
            ("Host", "monitor.example"),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", &remote_token),
            ("Forwarded", "host=attacker.example"),
            ("Content-Type", "application/json"),
        ],
        create_body,
    );
    assert_eq!(forwarded.status, 403);

    assert_eq!(
        server
            .request("GET", "/api/health", &[("Host", "monitor.example")], "")
            .status,
        404
    );
    assert_eq!(
        server
            .request("POST", "/api/notify", &[("Host", "monitor.example")], "")
            .status,
        404
    );
    assert_eq!(
        server
            .request(
                "GET",
                "/monitor/assets/app.js",
                &[("Host", "monitor.example")],
                ""
            )
            .status,
        404
    );
    assert_eq!(
        server
            .request("GET", "/", &[("Host", "unregistered.example")], "")
            .status,
        403
    );
    assert_eq!(
        server
            .request(
                "GET",
                &format!(
                    "/assets/monitor/{}",
                    entry_script(MONITOR_ASSETS, "monitor-")
                ),
                &[("Host", "unregistered.example")],
                ""
            )
            .status,
        403
    );

    let local_monitor_alias = ureq::get(&format!(
        "http://127.0.0.1:{}/assets/monitor/{}",
        server.local.port(),
        entry_script(MONITOR_ASSETS, "monitor-")
    ))
    .call()
    .unwrap_err();
    assert!(local_monitor_alias.to_string().contains("404"));

    let serve_info = std::fs::read_to_string(home.path().join("serve.json")).unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&serve_info).unwrap()["port"],
        server.local.port()
    );
    drop(server);
    assert!(!home.path().join("serve.json").exists());
}
