//! Waiting for a server that a test runs on its own thread, without ever hanging the test binary.
//!
//! The server reports its address through a channel once it is ready and stops when its oneshot
//! fires. A start that is still running after [`SERVER_WAIT`] is asked to stop and fails the test.
//! Its thread is left behind instead of joined: joining a server that never ends would block
//! while the caller still holds the lock that serializes `AGBOARD_HOME`, and every other test of
//! the binary would then wait on that lock forever.

#![allow(dead_code)]

use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tokio::sync::oneshot::Sender;

/// How long a server thread may take to become ready, or to end after it is asked to stop.
pub const SERVER_WAIT: Duration = Duration::from_secs(30);

/// A server thread that reported ready.
pub struct Started<T, R> {
    pub ready: T,
    pub stop: Sender<()>,
    pub handle: JoinHandle<R>,
}

/// Wait for the ready message of the server thread `handle`.
///
/// Returns the message, or the thread's result when it ended without becoming ready. A panic
/// of the thread is raised again here. A thread that is still starting after [`SERVER_WAIT`] is
/// sent `stop` and the test panics without joining it.
pub fn wait_ready<T, R>(
    ready: &Receiver<T>,
    stop: Sender<()>,
    handle: JoinHandle<R>,
) -> Result<Started<T, R>, R> {
    match ready.recv_timeout(SERVER_WAIT) {
        Ok(ready) => Ok(Started {
            ready,
            stop,
            handle,
        }),
        Err(RecvTimeoutError::Disconnected) => {
            // The ready sender is gone, so the server returned (or panicked) before it was ready.
            match finish(Some(stop), handle) {
                Some(Ok(result)) => Err(result),
                Some(Err(panic)) => std::panic::resume_unwind(panic),
                None => unreachable!("finish panics unless it returns the result"),
            }
        }
        Err(RecvTimeoutError::Timeout) => {
            let _ = stop.send(());
            panic!(
                "the server did not become ready within {SERVER_WAIT:?}; it was asked to stop \
                 and its thread was left running so the other tests are not blocked"
            );
        }
    }
}

/// Ask the server to stop and wait at most [`SERVER_WAIT`] for its thread.
///
/// Returns what the thread returned (or its panic). A thread that does not end in time fails
/// the test; while the caller is already unwinding it is left running and `None` is returned,
/// because a second panic would abort the whole binary.
pub fn finish<R>(
    stop: Option<Sender<()>>,
    handle: JoinHandle<R>,
) -> Option<std::thread::Result<R>> {
    if let Some(stop) = stop {
        let _ = stop.send(());
    }
    let deadline = Instant::now() + SERVER_WAIT;
    while !handle.is_finished() {
        if Instant::now() >= deadline {
            if std::thread::panicking() {
                return None;
            }
            panic!(
                "the server thread did not end within {SERVER_WAIT:?} after it was asked to stop"
            );
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    Some(handle.join())
}
