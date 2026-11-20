//! Matching helpers for the rules: question marks and `agboard` commands in
//! the text of a tool call.

/// Whether the last non-empty line of `text` ends with a question mark, once
/// closing markup and quotes are ignored.
pub fn ends_with_question(text: &str) -> bool {
    let Some(line) = text.lines().rev().map(str::trim).find(|l| !l.is_empty()) else {
        return false;
    };
    if line.starts_with("```") {
        return false;
    }
    let trimmed = line.trim_end_matches(|c: char| {
        c.is_whitespace()
            || matches!(
                c,
                '*' | '_'
                    | '`'
                    | '"'
                    | '\''
                    | ')'
                    | ']'
                    | '}'
                    | '」'
                    | '』'
                    | '）'
                    | '”'
                    | '’'
                    | '>'
            )
    });
    trimmed.ends_with('?') || trimmed.ends_with('？')
}

pub(super) fn tokens(command: &str) -> Vec<&str> {
    command
        .split(|c: char| {
            c.is_whitespace()
                || matches!(
                    c,
                    '"' | '\'' | '\\' | ',' | '[' | ']' | '(' | ')' | ';' | '&' | '|'
                )
        })
        .filter(|t| !t.is_empty())
        .collect()
}

pub(super) fn contains_sequence(tokens: &[&str], sequence: &[&str]) -> bool {
    tokens.windows(sequence.len()).any(|w| w == sequence)
}

/// Whether `command` runs `agboard` with any of the subcommand sequences,
/// global flags in between allowed.
pub fn runs_agboard(command: &str, sequences: &[&[&str]]) -> bool {
    let tokens = tokens(command);
    let Some(from) = tokens
        .iter()
        .position(|t| *t == "agboard" || t.ends_with("/agboard"))
    else {
        return false;
    };
    sequences
        .iter()
        .any(|s| contains_sequence(&tokens[from..], s))
}
