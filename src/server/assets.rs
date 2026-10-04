//! The web UI files embedded in the executable and the session token.

use crate::error::SkanError;

/// `web/dist/index.html`, with [`TOKEN_PLACEHOLDER`] in the token `<meta>`.
pub const INDEX_HTML: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/web/dist/index.html"));
pub const APP_JS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/web/dist/assets/app.js"
));
pub const APP_CSS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/web/dist/assets/app.css"
));

pub const LOGO_PNG: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/web/dist/logo.png"));

pub const LOGO_WHITE_PNG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/web/dist/logo-white.png"
));

/// What the web build leaves in `index.html` for the server to fill in.
pub const TOKEN_PLACEHOLDER: &str = "{{SKAN_TOKEN}}";

/// Number of random bytes behind a session token (64 hex characters).
const TOKEN_BYTES: usize = 32;

/// `template` with the token placeholder replaced by `token`.
pub fn render_index(template: &str, token: &str) -> String {
    template.replace(TOKEN_PLACEHOLDER, token)
}

/// Lowercase hexadecimal text of `bytes`.
pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A new session token: 32 random bytes as 64 lowercase hex characters.
pub fn new_token() -> Result<String, SkanError> {
    let mut bytes = [0u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|e| SkanError::DatabaseError {
        reason: format!("Cannot create a session token: {e}"),
    })?;
    Ok(to_hex(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_is_lowercase_and_zero_padded() {
        assert_eq!(to_hex(&[0x00, 0x0f, 0xa5, 0xff]), "000fa5ff");
        assert_eq!(to_hex(&[]), "");
    }

    #[test]
    fn render_index_replaces_the_placeholder() {
        let html = r#"<meta name="skan-token" content="{{SKAN_TOKEN}}" />"#;
        assert_eq!(
            render_index(html, "abc123"),
            r#"<meta name="skan-token" content="abc123" />"#
        );
    }

    #[test]
    fn render_index_leaves_other_text_alone() {
        assert_eq!(render_index("<p>hello</p>", "abc"), "<p>hello</p>");
    }

    #[test]
    fn the_embedded_index_has_one_placeholder_and_the_app_script() {
        assert_eq!(INDEX_HTML.matches(TOKEN_PLACEHOLDER).count(), 1);
        assert!(INDEX_HTML.contains(r#"src="/assets/app.js""#));
        assert!(!APP_JS.is_empty());
        assert!(!APP_CSS.is_empty());
    }

    #[test]
    fn a_token_is_64_lowercase_hex_characters_and_never_repeats() {
        let a = new_token().unwrap();
        let b = new_token().unwrap();
        for token in [&a, &b] {
            assert_eq!(token.len(), 64);
            assert!(
                token
                    .chars()
                    .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
            );
        }
        assert_ne!(a, b);
    }
}
