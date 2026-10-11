use agent_board::domain::{
    normalize_and_validate_description, validate_board_name, validate_reason, validate_title,
};
use agent_board::error::AgboardError;

fn invalid(field: &str, reason: &str) -> AgboardError {
    AgboardError::InvalidValue {
        field: field.into(),
        reason: reason.into(),
    }
}

const NAME_REASON: &str = "Board names must be 1 to 50 characters on one line.";
const TITLE_REASON: &str = "Titles must be 1 to 100 characters on one line.";
const REASON_REASON: &str = "Reasons must be 1 to 100 characters on one line.";

#[test]
fn board_name_limits() {
    assert_eq!(validate_board_name(""), Err(invalid("name", NAME_REASON)));
    assert_eq!(
        validate_board_name("   "),
        Err(invalid("name", NAME_REASON))
    );
    assert_eq!(validate_board_name("a"), Ok("a".to_string()));
    assert_eq!(validate_board_name(&"a".repeat(50)), Ok("a".repeat(50)));
    assert_eq!(
        validate_board_name(&"a".repeat(51)),
        Err(invalid("name", NAME_REASON))
    );
    assert_eq!(
        validate_board_name("one\ntwo"),
        Err(invalid("name", NAME_REASON))
    );
    assert_eq!(
        validate_board_name("one\rtwo"),
        Err(invalid("name", NAME_REASON))
    );
}

#[test]
fn board_name_is_trimmed_before_counting() {
    assert_eq!(validate_board_name("  board \t"), Ok("board".to_string()));
    let padded = format!("  {}  ", "a".repeat(50));
    assert_eq!(validate_board_name(&padded), Ok("a".repeat(50)));
    // a trailing newline is surrounding whitespace, so it is trimmed away
    assert_eq!(validate_board_name("board\n"), Ok("board".to_string()));
}

#[test]
fn title_limits() {
    assert_eq!(validate_title(""), Err(invalid("title", TITLE_REASON)));
    assert_eq!(validate_title(" \t "), Err(invalid("title", TITLE_REASON)));
    assert_eq!(validate_title("t"), Ok("t".to_string()));
    assert_eq!(validate_title(&"a".repeat(100)), Ok("a".repeat(100)));
    assert_eq!(
        validate_title(&"a".repeat(101)),
        Err(invalid("title", TITLE_REASON))
    );
    assert_eq!(validate_title("a\nb"), Err(invalid("title", TITLE_REASON)));
    assert_eq!(
        validate_title("  Write docs  "),
        Ok("Write docs".to_string())
    );
}

#[test]
fn reason_limits() {
    assert_eq!(validate_reason(""), Err(invalid("reason", REASON_REASON)));
    assert_eq!(validate_reason("  "), Err(invalid("reason", REASON_REASON)));
    assert_eq!(validate_reason("waiting"), Ok("waiting".to_string()));
    assert_eq!(validate_reason(&"a".repeat(100)), Ok("a".repeat(100)));
    assert_eq!(
        validate_reason(&"a".repeat(101)),
        Err(invalid("reason", REASON_REASON))
    );
    assert_eq!(
        validate_reason("a\nb"),
        Err(invalid("reason", REASON_REASON))
    );
    assert_eq!(validate_reason("  waiting  "), Ok("waiting".to_string()));
}

#[test]
fn counts_unicode_scalar_values_not_bytes() {
    // each Japanese character is 3 bytes in UTF-8 but one scalar value
    assert_eq!(validate_title(&"あ".repeat(100)), Ok("あ".repeat(100)));
    assert_eq!(
        validate_title(&"あ".repeat(101)),
        Err(invalid("title", TITLE_REASON))
    );
    assert_eq!(validate_board_name(&"日".repeat(50)), Ok("日".repeat(50)));
    assert_eq!(
        validate_board_name(&"日".repeat(51)),
        Err(invalid("name", NAME_REASON))
    );
    // an emoji is one scalar value; a family emoji (ZWJ sequence) is five
    assert_eq!(validate_title(&"😀".repeat(100)), Ok("😀".repeat(100)));
    assert_eq!(validate_title(&"👨‍👩‍👧".repeat(20)), Ok("👨‍👩‍👧".repeat(20)));
    assert_eq!(
        validate_title(&"👨‍👩‍👧".repeat(21)),
        Err(invalid("title", TITLE_REASON))
    );
    assert_eq!(
        normalize_and_validate_description(&"あ".repeat(50_000)),
        Ok("あ".repeat(50_000))
    );
    assert_eq!(
        normalize_and_validate_description(&"あ".repeat(50_001)),
        Err(invalid(
            "description",
            "Descriptions must be 50,000 characters or fewer. This one has 50001."
        ))
    );
}

#[test]
fn description_limits() {
    assert_eq!(normalize_and_validate_description(""), Ok(String::new()));
    assert_eq!(
        normalize_and_validate_description(&"a".repeat(50_000)),
        Ok("a".repeat(50_000))
    );
    assert_eq!(
        normalize_and_validate_description(&"a".repeat(50_001)),
        Err(invalid(
            "description",
            "Descriptions must be 50,000 characters or fewer. This one has 50001."
        ))
    );
    assert_eq!(
        normalize_and_validate_description(&"a".repeat(50_342)),
        Err(invalid(
            "description",
            "Descriptions must be 50,000 characters or fewer. This one has 50342."
        ))
    );
}

#[test]
fn description_keeps_newlines_and_surrounding_whitespace() {
    assert_eq!(
        normalize_and_validate_description("  line one\nline two\n"),
        Ok("  line one\nline two\n".to_string())
    );
}

#[test]
fn description_normalizes_crlf_before_counting() {
    assert_eq!(
        normalize_and_validate_description("a\r\nb\r\nc"),
        Ok("a\nb\nc".to_string())
    );
    // 150 x "a\r\n" is 75000 raw characters but 50000 after normalization
    let crlf = "a\r\n".repeat(25_000);
    assert_eq!(
        normalize_and_validate_description(&crlf),
        Ok("a\n".repeat(25_000))
    );
    // one more makes it 50001 after normalization
    let crlf = "a\r\n".repeat(25_000) + "b";
    assert_eq!(
        normalize_and_validate_description(&crlf),
        Err(invalid(
            "description",
            "Descriptions must be 50,000 characters or fewer. This one has 50001."
        ))
    );
}
