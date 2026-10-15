// Notification client for a running "agboard serve".
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use crate::paths;

/// How long a notification may take in total: connect, send and the reply.
pub const NOTIFY_TIMEOUT: Duration = Duration::from_millis(300);

/// Only the status line of the reply is needed.
const MAX_STATUS_LINE: usize = 256;

/// Tell the running `agboard serve` (found through `serve.json`) that the board
/// changed. Best effort: returns `false` when there is no `serve.json`, nothing
/// answers, the answer is not 204, or everything together takes longer than
/// [`NOTIFY_TIMEOUT`]. Never panics.
pub fn notify_serve() -> bool {
    match paths::data_dir() {
        Ok(dir) => notify_serve_in(&dir),
        Err(_) => false,
    }
}

/// Like [`notify_serve`], but finds `serve.json` in `dir` instead of the
/// default data directory. A command that works in one data directory tells
/// the server that belongs to that same directory.
pub fn notify_serve_in(dir: &std::path::Path) -> bool {
    let start = Instant::now();
    match paths::read_serve_info_in(dir) {
        Some(info) => notify_port(info.port, NOTIFY_TIMEOUT.saturating_sub(start.elapsed())),
        None => false,
    }
}

/// `POST /api/notify` to `127.0.0.1:<port>`; `true` only for a 204 reply within
/// `timeout` in total. Never panics.
pub fn notify_port(port: u16, timeout: Duration) -> bool {
    post_notify(port, Instant::now() + timeout).unwrap_or(false)
}

/// Time left until `deadline`, or `None` once it has passed (a zero timeout is
/// not a valid socket timeout).
fn remaining(deadline: Instant) -> Option<Duration> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|left| !left.is_zero())
}

fn post_notify(port: u16, deadline: Instant) -> Option<bool> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, remaining(deadline)?).ok()?;
    stream.set_write_timeout(Some(remaining(deadline)?)).ok()?;
    let request = format!(
        "POST /api/notify HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).ok()?;

    // Read until the status line is complete. Each read gets only the time
    // that is left, so a slowly dripping peer cannot extend the budget.
    let mut reply = Vec::new();
    let mut chunk = [0u8; 128];
    while !reply.contains(&b'\n') && reply.len() < MAX_STATUS_LINE {
        stream.set_read_timeout(Some(remaining(deadline)?)).ok()?;
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => reply.extend_from_slice(&chunk[..n]),
        }
    }
    let line = String::from_utf8_lossy(&reply);
    let status = line.lines().next()?.split_whitespace().nth(1)?;
    Some(status == "204")
}
