use super::*;

fn project() -> ProjectId {
    "0123456789abcdef0123456789abcdef".parse().unwrap()
}

fn attrs(key: &str, tool: Tool, origin: Origin) -> Attributes {
    Attributes {
        project: project(),
        key: key.into(),
        tool,
        origin,
    }
}

#[test]
fn a_session_in_grace_counts_until_the_grace_ends() {
    let registry = SessionRegistry::new(Duration::from_secs(30));
    let start = Instant::now();
    let wall = Utc::now();
    let hold = registry.register_at(attrs("a", Tool::Codex, Origin::External), start, wall);
    assert_eq!(
        registry.list_at(&project(), start, wall).counts.connected,
        1
    );

    hold.release_at(start, wall);
    let in_grace = registry.list_at(&project(), start + Duration::from_secs(29), wall);
    assert_eq!(in_grace.counts.total, 1);
    assert_eq!(in_grace.counts.connected, 0);
    assert_eq!(in_grace.sessions[0].state, State::Grace);
    let gone = registry.list_at(&project(), start + Duration::from_secs(30), wall);
    assert_eq!(gone.counts.total, 0);
}

#[test]
fn a_reconnect_in_grace_is_the_same_session() {
    let registry = SessionRegistry::new(Duration::from_secs(30));
    let start = Instant::now();
    let first = Utc::now();
    let hold = registry.register_at(attrs("a", Tool::ClaudeCode, Origin::Board), start, first);
    hold.release_at(start, first);
    let later = first + chrono::Duration::seconds(10);
    let at = start + Duration::from_secs(10);
    let _again = registry.register_at(attrs("a", Tool::ClaudeCode, Origin::Board), at, later);
    let list = registry.list_at(&project(), at, later);
    assert_eq!(list.counts.total, 1);
    assert_eq!(list.sessions[0].connected_at, first);
    assert_eq!(list.sessions[0].state, State::Connected);
}

#[test]
fn overlapping_streams_of_one_session_stay_one_session_until_both_close() {
    let registry = SessionRegistry::new(Duration::from_secs(30));
    let a = registry.register(attrs("a", Tool::Codex, Origin::External));
    let b = registry.register(attrs("a", Tool::Codex, Origin::External));
    drop(a);
    assert_eq!(registry.list(&project()).counts.connected, 1);
    drop(b);
    assert_eq!(registry.list(&project()).counts.connected, 0);
    assert_eq!(registry.list(&project()).counts.total, 1);
}

#[test]
fn board_sessions_are_limited_to_one_in_total_and_external_ones_are_not() {
    let registry = SessionRegistry::new(Duration::from_secs(30));
    let _e1 = registry.register(attrs("e1", Tool::Codex, Origin::External));
    let _e2 = registry.register(attrs("e2", Tool::Codex, Origin::External));
    assert!(registry.check_board_launch().is_ok());
    let _board = registry.register(attrs("b", Tool::Codex, Origin::Board));
    assert_eq!(
        registry.check_board_launch(),
        Err(LaunchRefused { tool: Tool::Codex })
    );
}

#[test]
fn keys_are_limited_to_a_safe_alphabet() {
    assert!(valid_key("claude:0a1b-2c.3_d"));
    assert!(!valid_key(""));
    assert!(!valid_key("has space"));
    assert!(!valid_key(&"a".repeat(65)));
}
