//! Listening on 127.0.0.1, and what a failure to listen means.
//!
//! A port that is taken is `port_in_use`, named by what holds it. A refusal by
//! the OS or a sandbox is `local_network_denied`, which needs another fix.
//! An automatic server takes a free port when its preferred one is taken.

use std::io;
use std::net::TcpListener;

use crate::error::{AgboardError, PortHolder};

/// The kind of a failure to listen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BindFailure {
    InUse,
    Denied,
    Other,
}

/// Sort a failure to listen by the reason the OS gave.
pub(crate) fn classify(error: &io::Error) -> BindFailure {
    let raw = error.raw_os_error();
    if error.kind() == io::ErrorKind::AddrInUse || raw == Some(libc::EADDRINUSE) {
        BindFailure::InUse
    } else if error.kind() == io::ErrorKind::PermissionDenied
        || raw == Some(libc::EACCES)
        || raw == Some(libc::EPERM)
    {
        BindFailure::Denied
    } else {
        BindFailure::Other
    }
}

/// Whether a failed connection to 127.0.0.1 was refused by the OS or a sandbox,
/// rather than by a port that nothing listens on.
pub(crate) fn is_denied(error: &io::Error) -> bool {
    classify(error) == BindFailure::Denied
}

/// The error of a failure to listen on `port`.
pub(crate) fn bind_error(error: &io::Error, port: u16) -> AgboardError {
    match classify(error) {
        BindFailure::InUse => AgboardError::PortInUse {
            port,
            holder: port_holder(port),
        },
        BindFailure::Denied => AgboardError::LocalNetworkDenied,
        BindFailure::Other => AgboardError::BoardUnavailable {
            reason: format!("Cannot listen on 127.0.0.1:{port}: {error}."),
        },
    }
}

/// What holds `port`: an Agent Board server answers its health check with its
/// process ID; anything else is another program.
pub(crate) fn port_holder(port: u16) -> PortHolder {
    match super::instance::health_pid(port) {
        Some(pid) => PortHolder::AgentBoard { pid },
        None => PortHolder::OtherProgram,
    }
}

/// Listen on exactly `port` (0 lets the OS choose).
pub(crate) fn bind_exact(port: u16) -> Result<TcpListener, AgboardError> {
    TcpListener::bind(("127.0.0.1", port)).map_err(|e| bind_error(&e, port))
}

/// Listen on `port`, or on a port the OS chooses when `port` is taken. The
/// second value says why another port was used.
pub(crate) fn bind_preferring(port: u16) -> Result<(TcpListener, Option<String>), AgboardError> {
    if port == 0 {
        return bind_exact(0).map(|listener| (listener, None));
    }
    match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => Ok((listener, None)),
        Err(error) if classify(&error) == BindFailure::InUse => {
            let holder = port_holder(port);
            let listener = bind_exact(0)?;
            let chosen = listener
                .local_addr()
                .map(|addr| addr.port())
                .unwrap_or_default();
            Ok((listener, Some(another_port_notice(port, holder, chosen))))
        }
        Err(error) => Err(bind_error(&error, port)),
    }
}

/// The line that says why the server uses `chosen` instead of `port`.
pub(crate) fn another_port_notice(port: u16, holder: PortHolder, chosen: u16) -> String {
    match holder {
        PortHolder::AgentBoard { pid } => format!(
            "Port {port} is used by another Agent Board server (pid {pid}) with a different data folder, so this server uses port {chosen}."
        ),
        PortHolder::OtherProgram | PortHolder::Unknown => {
            format!("Port {port} is used by another program, so this server uses port {chosen}.")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failures_to_listen_are_sorted_by_the_os_reason() {
        let cases = [
            (
                io::Error::from_raw_os_error(libc::EADDRINUSE),
                BindFailure::InUse,
            ),
            (
                io::Error::from_raw_os_error(libc::EACCES),
                BindFailure::Denied,
            ),
            (
                io::Error::from_raw_os_error(libc::EPERM),
                BindFailure::Denied,
            ),
            (
                io::Error::from(io::ErrorKind::AddrInUse),
                BindFailure::InUse,
            ),
            (
                io::Error::from(io::ErrorKind::PermissionDenied),
                BindFailure::Denied,
            ),
            (
                io::Error::from_raw_os_error(libc::EADDRNOTAVAIL),
                BindFailure::Other,
            ),
            (io::Error::other("boom"), BindFailure::Other),
        ];
        for (error, expected) in cases {
            assert_eq!(classify(&error), expected, "{error:?}");
        }
    }

    #[test]
    fn a_refusal_is_local_network_denied_and_other_failures_keep_the_os_message() {
        let denied = bind_error(&io::Error::from_raw_os_error(libc::EPERM), 7661);
        assert_eq!(denied.code(), "local_network_denied");
        let other = bind_error(&io::Error::from_raw_os_error(libc::EADDRNOTAVAIL), 7661);
        assert_eq!(other.code(), "board_unavailable");
        assert!(
            other
                .reason()
                .starts_with("Cannot listen on 127.0.0.1:7661: ")
        );
    }

    #[test]
    fn a_taken_port_held_by_another_program_is_named_so() {
        let held = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = held.local_addr().unwrap().port();
        let error = bind_exact(port).unwrap_err();
        assert_eq!(
            error,
            AgboardError::PortInUse {
                port,
                holder: PortHolder::OtherProgram
            }
        );
    }

    #[test]
    fn a_taken_preferred_port_gives_a_free_one_and_says_why() {
        let held = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = held.local_addr().unwrap().port();
        let (listener, notice) = bind_preferring(port).unwrap();
        let chosen = listener.local_addr().unwrap().port();
        assert_ne!(chosen, port);
        assert_eq!(
            notice.unwrap(),
            format!("Port {port} is used by another program, so this server uses port {chosen}.")
        );
        let (free, none) = bind_preferring(0).unwrap();
        assert_ne!(free.local_addr().unwrap().port(), 0);
        assert_eq!(none, None);
    }

    #[test]
    fn the_notice_names_another_agent_board_server() {
        assert_eq!(
            another_port_notice(7420, PortHolder::AgentBoard { pid: 41235 }, 52114),
            "Port 7420 is used by another Agent Board server (pid 41235) with a different data folder, so this server uses port 52114."
        );
    }
}
