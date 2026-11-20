//! The tail of a launched session's log, for the local page.

use std::fs::File;
use std::io::{ErrorKind, Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;

use crate::error::{AgboardError, FileAction};

/// The most bytes of a log one read returns.
pub const MAX_TAIL_BYTES: u64 = 64 * 1024;

/// What `GET /api/projects/{id}/sessions/log` returns.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LogTail {
    pub tool: &'static str,
    pub exists: bool,
    pub text: String,
    /// True when the file is larger than the limit and the start was cut off.
    pub truncated: bool,
    /// The size of the whole file, in bytes.
    pub size: u64,
}

/// Read at most [`MAX_TAIL_BYTES`] from the end of `path`, starting at a line boundary when the
/// start was cut. A missing file is `exists: false`. Only the tail is read, never the whole file.
pub fn read_tail(tool: &'static str, path: &Path) -> Result<LogTail, AgboardError> {
    let missing = LogTail {
        tool,
        exists: false,
        text: String::new(),
        truncated: false,
        size: 0,
    };
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(missing),
        Err(e) => return Err(io_error(tool, &e)),
    };
    let size = file.metadata().map_err(|e| io_error(tool, &e))?.len();
    let start = size.saturating_sub(MAX_TAIL_BYTES);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| io_error(tool, &e))?;
    let mut bytes = Vec::new();
    file.take(MAX_TAIL_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|e| io_error(tool, &e))?;
    let truncated = start > 0;
    if truncated {
        // Drop the partial first line; a tail with no newline at all keeps nothing.
        let from = bytes
            .iter()
            .position(|b| *b == b'\n')
            .map_or(bytes.len(), |i| i + 1);
        bytes.drain(..from);
    }
    Ok(LogTail {
        tool,
        exists: true,
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
        size,
    })
}

fn io_error(tool: &str, error: &std::io::Error) -> AgboardError {
    AgboardError::FileError {
        action: FileAction::Read,
        file: format!("resident/{tool}.log"),
        reason: error.to_string(),
    }
}
