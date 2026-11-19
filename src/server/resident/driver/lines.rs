//! Reading the output of a CLI line by line with a cap on the size of a line.

use std::io::{BufRead, BufReader, Read};

/// The longest line read from the CLI. A longer one is dropped, and the stream goes on.
pub(super) const MAX_LINE: usize = 8 * 1024 * 1024;

pub(super) enum Line<'a> {
    Text(&'a str),
    TooLong,
}

/// Call `each` for every line of `reader`; a line over `max` bytes is skipped to its end.
pub(super) fn for_each_line(reader: impl Read, max: usize, mut each: impl FnMut(Line<'_>)) {
    let mut reader = BufReader::new(reader);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader
            .by_ref()
            .take(max as u64 + 1)
            .read_until(b'\n', &mut buf)
        {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if buf.last() != Some(&b'\n') && buf.len() > max {
            skip_rest(&mut reader);
            each(Line::TooLong);
            continue;
        }
        let text = String::from_utf8_lossy(&buf);
        each(Line::Text(text.trim_end_matches(['\r', '\n'])));
    }
}

/// Read up to the end of the current line and drop it.
fn skip_rest(reader: &mut impl BufRead) {
    let mut sink = Vec::new();
    loop {
        sink.clear();
        match reader.by_ref().take(64 * 1024).read_until(b'\n', &mut sink) {
            Ok(0) | Err(_) => return,
            Ok(_) if sink.last() == Some(&b'\n') => return,
            Ok(_) => {}
        }
    }
}
