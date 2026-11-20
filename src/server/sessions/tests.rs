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

#[test]
fn a_session_added_from_outside_the_registry_is_counted_with_the_external_ones() {
    let registry = SessionRegistry::new(Duration::from_secs(30));
    let _external = registry.register(attrs("ext", Tool::Codex, Origin::External));
    let wall = Utc::now();
    let board = SessionView {
        id: "resident:r1".into(),
        tool: Tool::ClaudeCode,
        origin: Origin::Board,
        connected_at: wall - chrono::Duration::seconds(5),
        last_seen_at: wall,
        state: State::Connected,
    };
    let list = registry.list(&project()).with_session(board);
    assert_eq!(list.counts.total, 2);
    assert_eq!(list.counts.connected, 2);
    assert_eq!(list.counts.by_origin.board, 1);
    assert_eq!(list.counts.by_origin.external, 1);
    assert_eq!(list.counts.by_tool.claude_code, 1);
    assert_eq!(list.counts.by_tool.codex, 1);
    // The older one comes first.
    assert_eq!(list.sessions[0].origin, Origin::Board);
}

fn minutes(n: u64) -> Duration {
    Duration::from_secs(n * 60)
}

#[test]
fn an_access_counts_an_external_session_for_five_minutes() {
    let registry = SessionRegistry::new(Duration::from_secs(30));
    let start = Instant::now();
    let wall = Utc::now();
    registry.touch_at(attrs("a", Tool::ClaudeCode, Origin::External), start, wall);

    let list = registry.list_at(&project(), start, wall);
    assert_eq!(list.counts.total, 1);
    assert_eq!(list.counts.connected, 0);
    assert_eq!(list.counts.by_origin.external, 1);
    assert_eq!(list.sessions[0].state, State::Grace);
    assert_eq!(list.sessions[0].last_seen_at, wall);

    let almost = start + minutes(5) - Duration::from_secs(1);
    assert_eq!(registry.list_at(&project(), almost, wall).counts.total, 1);
    let gone = registry.list_at(&project(), start + minutes(5), wall);
    assert_eq!(gone.counts.total, 0);
}

#[test]
fn a_later_access_extends_the_window_and_keeps_the_session() {
    let registry = SessionRegistry::new(Duration::from_secs(30));
    let start = Instant::now();
    let first = Utc::now();
    registry.touch_at(attrs("a", Tool::Codex, Origin::External), start, first);
    let later = first + chrono::Duration::minutes(4);
    let at = start + minutes(4);
    registry.touch_at(attrs("a", Tool::Codex, Origin::External), at, later);
    let list = registry.list_at(&project(), start + minutes(8), later);
    assert_eq!(list.counts.total, 1);
    assert_eq!(list.sessions[0].connected_at, first);
    assert_eq!(list.sessions[0].last_seen_at, later);
    assert_eq!(
        registry
            .list_at(&project(), start + minutes(9), later)
            .counts
            .total,
        0
    );
}

#[test]
fn an_open_stream_outlasts_the_access_window() {
    let registry = SessionRegistry::new(Duration::from_secs(30));
    let start = Instant::now();
    let wall = Utc::now();
    let hold = registry.register_at(attrs("a", Tool::Codex, Origin::External), start, wall);
    registry.touch_at(attrs("a", Tool::Codex, Origin::External), start, wall);
    let list = registry.list_at(&project(), start + minutes(30), wall);
    assert_eq!(list.counts.total, 1);
    assert_eq!(list.counts.connected, 1);
    // Once it closes, the later of the grace and the access window decides.
    hold.release_at(start + minutes(30), wall);
    assert_eq!(
        registry
            .list_at(
                &project(),
                start + minutes(30) + Duration::from_secs(31),
                wall
            )
            .counts
            .total,
        0
    );
}

#[test]
fn an_access_shortly_before_a_wait_ends_keeps_the_session_for_the_window() {
    let registry = SessionRegistry::new(Duration::from_secs(30));
    let start = Instant::now();
    let wall = Utc::now();
    let hold = registry.register_at(attrs("a", Tool::Codex, Origin::External), start, wall);
    registry.touch_at(attrs("a", Tool::Codex, Origin::External), start, wall);
    hold.release_at(start, wall);
    let list = registry.list_at(&project(), start + Duration::from_secs(120), wall);
    assert_eq!(list.counts.total, 1);
    assert_eq!(list.counts.connected, 0);
}

#[test]
fn a_board_launched_session_is_not_counted_by_an_access() {
    let registry = SessionRegistry::new(Duration::from_secs(30));
    let start = Instant::now();
    let wall = Utc::now();
    registry.touch_at(attrs("b", Tool::Codex, Origin::Board), start, wall);
    assert_eq!(registry.list_at(&project(), start, wall).counts.total, 0);
    assert!(!registry.has_board(Tool::Codex));

    // A board session that waits is counted once, and an access under the same key does not
    // add an external entry or change its origin.
    let _hold = registry.register_at(attrs("b", Tool::Codex, Origin::Board), start, wall);
    registry.touch_at(attrs("b", Tool::Codex, Origin::External), start, wall);
    let list = registry.list_at(&project(), start, wall);
    assert_eq!(list.counts.total, 1);
    assert_eq!(list.counts.by_origin.board, 1);
    assert_eq!(list.counts.by_origin.external, 0);
}

#[test]
fn an_access_does_not_count_against_the_board_launch_limit() {
    let registry = SessionRegistry::new(Duration::from_secs(30));
    registry.touch(attrs("e", Tool::Codex, Origin::External));
    assert!(registry.check_board_launch().is_ok());
}
