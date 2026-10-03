//! Telling whether another `skan serve` is already running, and cleaning up
//! `serve.json` on exit.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::Path;
use std::time::Duration;

use serde::Deserialize;

use crate::paths::ServeInfo;

/// How long the health check of a possibly running server may take.
const HEALTH_TIMEOUT: Duration = Duration::from_millis(1000);

/// The most of a health response that is read.
const MAX_RESPONSE: u64 = 16 * 1024;

#[derive(Deserialize)]
struct Health {
    ok: bool,
    pid: u32,
}

/// Whether `info` describes a server that is still alive: something on its
/// port answers `GET /api/health` with the same `pid`. Anything else (no
/// answer, a different pid, garbage) means the file is stale.
pub(crate) fn is_serving(info: &ServeInfo) -> bool {
    health_pid(info.port) == Some(info.pid)
}

fn health_pid(port: u16) -> Option<u32> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, HEALTH_TIMEOUT).ok()?;
    stream.set_read_timeout(Some(HEALTH_TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(HEALTH_TIMEOUT)).ok()?;
    // HTTP/1.0 so the reply has a Content-Length and the connection closes.
    let request = format!("GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = Vec::new();
    stream.take(MAX_RESPONSE).read_to_end(&mut response).ok()?;
    let text = String::from_utf8(response).ok()?;
    let (head, body) = text.split_once("\r\n\r\n")?;
    if head.split_whitespace().nth(1) != Some("200") {
        return None;
    }
    let health: Health = serde_json::from_str(body).ok()?;
    health.ok.then_some(health.pid)
}

/// Remove the `serve.json` at `path`, but only if it still names `pid`. A file
/// another process wrote in the meantime is left alone.
pub(crate) fn remove_serve_info_of(path: &Path, pid: u32) {
    let ours = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<ServeInfo>(&text).ok())
        .is_some_and(|info| info.pid == pid);
    if ours {
        let _ = std::fs::remove_file(path);
    }
}
