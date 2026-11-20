//! Telling the board that an agent session used it. Every `agboard` command and hook run inside an
//! external agent session sends one short request to the running server, so the board can count
//! the session for five minutes whether or not it waits.
//!
//! The call is best effort and never changes what the command does: it needs a `serve.json` that
//! names a server, never starts one, gives up after [`TOUCH_TIMEOUT`] in total, ignores every
//! failure, and prints nothing. It sends only the hashed key, the tool, the origin and the
//! project's ID, never any other environment value.
//!
//! Which sessions touch: the key must come from the agent's own session variable
//! (`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`). A key made from the parent process ID does not,
//! because tools that start a shell for each command give every command another parent, so each
//! `agboard` call would count as a new session, and a person's own terminal would show up as one.
//! A session the board launched does not touch either: the launcher counts it.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};

use super::session_identity::SessionIdentity;
use crate::domain::ProjectId;
use crate::paths;
use crate::server::sessions::{
    Origin, SESSION_HEADER, SESSION_ORIGIN_HEADER, SESSION_PROJECT_HEADER, SESSION_TOOL_HEADER,
};

/// How long the whole call may take: connect, send and the reply.
pub(crate) const TOUCH_TIMEOUT: Duration = Duration::from_millis(300);

/// Whether a command of this session is reported to the board.
pub(crate) fn reports(identity: &SessionIdentity) -> bool {
    identity.origin == Origin::External && !identity.key.starts_with("ppid:")
}

/// Report the session of this process's environment, when it is one that reports. Does nothing
/// and returns at once when there is no server.
pub(crate) fn touch_from_env(data_dir: &Path, project: &ProjectId) {
    let identity = SessionIdentity::from_env();
    if reports(&identity) {
        touch(data_dir, project, &identity);
    }
}

/// Report `identity` as having used `project`, to the server that `serve.json` in `data_dir`
/// names. Every failure is ignored.
pub(crate) fn touch(data_dir: &Path, project: &ProjectId, identity: &SessionIdentity) {
    let Some(info) = paths::read_serve_info_in(data_dir) else {
        return;
    };
    let _ = send(info.port, project, identity, Instant::now() + TOUCH_TIMEOUT);
}

fn request_text(port: u16, project: &ProjectId, identity: &SessionIdentity) -> String {
    format!(
        "POST /api/projects/{project}/sessions/touch HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{SESSION_HEADER}: {key}\r\n{SESSION_TOOL_HEADER}: {tool}\r\n{SESSION_ORIGIN_HEADER}: {origin}\r\n{SESSION_PROJECT_HEADER}: {project}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        project = project.as_str(),
        key = identity.key,
        tool = identity.tool.as_str(),
        origin = identity.origin.as_str(),
    )
}

fn remaining(deadline: Instant) -> Option<Duration> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|left| !left.is_zero())
}

fn send(
    port: u16,
    project: &ProjectId,
    identity: &SessionIdentity,
    deadline: Instant,
) -> Option<()> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, remaining(deadline)?).ok()?;
    stream.set_write_timeout(Some(remaining(deadline)?)).ok()?;
    stream
        .write_all(request_text(port, project, identity).as_bytes())
        .ok()?;
    // Wait for the status line, so the server has the request before this process exits.
    stream.set_read_timeout(Some(remaining(deadline)?)).ok()?;
    let mut chunk = [0u8; 64];
    let _ = stream.read(&mut chunk);
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::sessions::Tool;

    fn project() -> ProjectId {
        "0123456789abcdef0123456789abcdef".parse().unwrap()
    }

    fn identity(key: &str, origin: Origin) -> SessionIdentity {
        SessionIdentity {
            key: key.into(),
            tool: Tool::ClaudeCode,
            origin,
        }
    }

    #[test]
    fn only_external_sessions_with_their_own_key_report() {
        assert!(reports(&identity(
            "claude:0011223344556677",
            Origin::External
        )));
        assert!(reports(&identity(
            "codex:0011223344556677",
            Origin::External
        )));
        assert!(!reports(&identity(
            "ppid:0011223344556677",
            Origin::External
        )));
        assert!(!reports(&identity(
            "resident:0011223344556677",
            Origin::Board
        )));
    }

    #[test]
    fn the_request_carries_only_the_identity_headers() {
        let text = request_text(
            4000,
            &project(),
            &identity("claude:0011223344556677", Origin::External),
        );
        assert!(text.starts_with(
            "POST /api/projects/0123456789abcdef0123456789abcdef/sessions/touch HTTP/1.1\r\n"
        ));
        assert!(text.contains("x-agboard-session: claude:0011223344556677\r\n"));
        assert!(text.contains("x-agboard-session-tool: claude-code\r\n"));
        assert!(text.contains("x-agboard-session-origin: external\r\n"));
        assert!(text.contains("x-agboard-session-project: 0123456789abcdef0123456789abcdef\r\n"));
        assert_eq!(text.matches("\r\n").count(), 9);
    }

    #[test]
    fn without_a_server_it_returns_quietly_and_quickly() {
        let dir = tempfile::tempdir().unwrap();
        let start = Instant::now();
        touch(
            dir.path(),
            &project(),
            &identity("claude:0011223344556677", Origin::External),
        );
        assert!(start.elapsed() < Duration::from_millis(250));
    }

    #[test]
    fn a_dead_port_is_ignored() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let start = Instant::now();
        let sent = send(
            port,
            &project(),
            &identity("claude:0011223344556677", Origin::External),
            Instant::now() + TOUCH_TIMEOUT,
        );
        assert!(sent.is_none());
        assert!(start.elapsed() < TOUCH_TIMEOUT + Duration::from_millis(200));
    }
}
