//! Human confirmation: terminal detection and the y/N prompt.

use std::io::{BufRead, IsTerminal, Write};

use crate::error::{AgboardError, FileAction};

/// True when a human can answer: no `--json`, and both stdin and stderr are
/// terminals.
pub fn is_interactive(json: bool) -> bool {
    !json && std::io::stdin().is_terminal() && std::io::stderr().is_terminal()
}

/// Write `<prompt> [y/N] ` to `output`, read one line from `input`, and return
/// whether the answer was `y` or `yes` (case-insensitive).
pub fn confirm(
    prompt: &str,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<bool, AgboardError> {
    write!(output, "{prompt} [y/N] ")
        .and_then(|()| output.flush())
        .map_err(|e| AgboardError::FileError {
            action: FileAction::Write,
            file: "standard error".to_string(),
            reason: e.to_string(),
        })?;

    let mut line = Vec::new();
    input
        .read_until(b'\n', &mut line)
        .map_err(|e| AgboardError::FileError {
            action: FileAction::Read,
            file: "standard input".to_string(),
            reason: e.to_string(),
        })?;

    // Bytes that are not UTF-8 cannot be "y" or "yes"; they cancel.
    let answer = String::from_utf8_lossy(&line).trim().to_lowercase();
    Ok(answer == "y" || answer == "yes")
}
