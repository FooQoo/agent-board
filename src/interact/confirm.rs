//! Human confirmation: terminal detection and the y/N prompt.

use std::io::{BufRead, Write};

use crate::error::SkanError;

/// True when a human can answer: no `--json`, and both stdin and stderr are
/// terminals.
pub fn is_interactive(json: bool) -> bool {
    let _ = json;
    todo!()
}

/// Write `<prompt> [y/N] ` to `output`, read one line from `input`, and return
/// whether the answer was `y` or `yes` (case-insensitive).
pub fn confirm(
    prompt: &str,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<bool, SkanError> {
    let _ = (prompt, input, output);
    todo!()
}
