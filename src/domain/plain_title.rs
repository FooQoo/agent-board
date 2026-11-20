//! Plain text for titles derived from Markdown bodies.

/// The first non-empty line of a Markdown text with its inline Markdown marks removed.
///
/// A title is shown as plain text, so the marks of the line it is cut from would appear
/// literally. The body itself keeps its Markdown.
pub fn first_line_plain(markdown: &str) -> String {
    let line = markdown
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or_default();
    strip_inline_markdown(line)
}

/// One line without its Markdown marks: leading heading, quote, and list markers, emphasis
/// (`**`, `__`, `*`, `_`), strikethrough, code backticks, links and images (kept as their
/// text). Underscores and asterisks that are plain characters, such as the ones in
/// `snake_case` or `2 * 3`, stay.
pub fn strip_inline_markdown(line: &str) -> String {
    let mut text = line.trim();
    loop {
        let next = strip_block_marker(text);
        if next.len() == text.len() {
            break;
        }
        text = next;
    }
    let chars: Vec<char> = text.chars().collect();
    let linked = unwrap_links(&chars);
    let out = remove_marks(&linked);
    out.trim().to_string()
}

fn strip_block_marker(text: &str) -> &str {
    let t = text.trim_start();
    if t.starts_with('#') {
        let rest = t.trim_start_matches('#');
        if rest.is_empty() || rest.starts_with(char::is_whitespace) {
            return rest.trim_start();
        }
        return t;
    }
    if let Some(rest) = t.strip_prefix('>') {
        return rest.trim_start();
    }
    for marker in ["- ", "* ", "+ "] {
        if let Some(rest) = t.strip_prefix(marker) {
            return rest.trim_start();
        }
    }
    let digits = t.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 {
        let rest = &t[digits..];
        for marker in [". ", ") "] {
            if let Some(rest) = rest.strip_prefix(marker) {
                return rest.trim_start();
            }
        }
    }
    t
}

/// `[text](url)` becomes `text` and `![alt](url)` becomes `alt`.
fn unwrap_links(chars: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        let image = chars[i] == '!' && chars.get(i + 1) == Some(&'[');
        let start = if image { i + 1 } else { i };
        if chars[start] == '['
            && let Some(close) = chars[start + 1..].iter().position(|&c| c == ']')
        {
            let close = start + 1 + close;
            if chars.get(close + 1) == Some(&'(')
                && let Some(end) = chars[close + 2..].iter().position(|&c| c == ')')
            {
                out.extend(unwrap_links(&chars[start + 1..close]));
                i = close + 2 + end + 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn remove_marks(chars: &[char]) -> String {
    let mut out = String::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '`' => i += 1,
            '~' if chars.get(i + 1) == Some(&'~') => i += 2,
            '*' | '_' => {
                let mut end = i;
                while end < chars.len() && chars[end] == c {
                    end += 1;
                }
                let before = i.checked_sub(1).map(|j| chars[j]);
                let after = chars.get(end).copied();
                let space = |x: Option<char>| x.is_none_or(char::is_whitespace);
                let word = |x: Option<char>| x.is_some_and(char::is_alphanumeric);
                let plain = if c == '_' {
                    word(before) && word(after)
                } else {
                    space(before) && space(after)
                };
                if plain {
                    out.extend(&chars[i..end]);
                }
                i = end;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_emphasis_code_and_strikethrough() {
        assert_eq!(strip_inline_markdown("**Which one?**"), "Which one?");
        assert_eq!(
            strip_inline_markdown("__Which__ *one* _now_?"),
            "Which one now?"
        );
        assert_eq!(
            strip_inline_markdown("Use `cargo test` ~~now~~"),
            "Use cargo test now"
        );
    }

    #[test]
    fn strips_block_markers() {
        assert_eq!(strip_inline_markdown("## **Heading**"), "Heading");
        assert_eq!(strip_inline_markdown("- item"), "item");
        assert_eq!(strip_inline_markdown("* item"), "item");
        assert_eq!(strip_inline_markdown("12. item"), "item");
        assert_eq!(strip_inline_markdown("> - quoted"), "quoted");
        assert_eq!(strip_inline_markdown("#hashtag"), "#hashtag");
    }

    #[test]
    fn keeps_link_text_and_image_alt() {
        assert_eq!(
            strip_inline_markdown("See [the **docs**](https://x.y/a_b)"),
            "See the docs"
        );
        assert_eq!(strip_inline_markdown("![shot](a.png) done"), "shot done");
        assert_eq!(strip_inline_markdown("[open"), "[open");
    }

    #[test]
    fn keeps_plain_characters() {
        assert_eq!(
            strip_inline_markdown("Rename snake_case_name"),
            "Rename snake_case_name"
        );
        assert_eq!(strip_inline_markdown("2 * 3 = 6"), "2 * 3 = 6");
        assert_eq!(strip_inline_markdown("Plain title"), "Plain title");
    }

    #[test]
    fn first_line_skips_blank_lines() {
        assert_eq!(first_line_plain("\n\n**Q?**\nbody **kept**"), "Q?");
        assert_eq!(first_line_plain("  \n"), "");
    }
}
