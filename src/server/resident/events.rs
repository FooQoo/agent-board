//! The server log of what happens to launched sessions: why and when each one stopped or exited.
//!
//! The lines go to the standard error of the server, which `serve -d` and an automatic server
//! keep in `serve.log`. Each line starts with the time (UTC), so a stop that looks like a crash
//! from the outside can be told apart afterwards.

use std::sync::Mutex;

use super::{Launcher, Live};
use crate::clock::{Clock, SystemClock, format_utc};
use crate::server::sessions::Tool;

/// Where the event lines go. The server writes to standard error; a test collects them.
pub(super) type Sink = Box<dyn Fn(&str) + Send + Sync>;

pub(super) struct Events {
    sink: Mutex<Option<Sink>>,
}

impl Events {
    pub(super) fn new() -> Events {
        Events {
            sink: Mutex::new(None),
        }
    }

    fn write(&self, line: &str) {
        match self.sink.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            Some(sink) => sink(line),
            None => eprintln!("{line}"),
        }
    }
}

/// One event line: `agboard: <time> resident <tool> <launch id> <what>`.
fn line(tool: Tool, launch_id: &str, what: &str) -> String {
    format!(
        "agboard: {} resident {} {launch_id} {what}",
        format_utc(SystemClock.now()),
        tool.as_str()
    )
}

fn uptime(live: &Live) -> String {
    let secs = live.started.elapsed().as_secs();
    format!("after {secs}s")
}

impl Launcher {
    /// Send the event lines to `sink` instead of standard error (tests).
    #[cfg(test)]
    pub(super) fn set_event_sink(&self, sink: Sink) {
        *self.events.sink.lock().unwrap_or_else(|e| e.into_inner()) = Some(sink);
    }

    /// A child was started.
    pub(super) fn log_started(&self, tool: Tool, launch_id: &str, pid: u32, model: Option<&str>) {
        let model = model.unwrap_or("default");
        self.events.write(&line(
            tool,
            launch_id,
            &format!("started: pid {pid}, model {model}"),
        ));
    }

    /// Someone asked for the child to end; `reason` says who and why.
    pub(super) fn log_stop_requested(&self, tool: Tool, live: &Live, reason: &str) {
        self.events.write(&line(
            tool,
            &live.launch_id,
            &format!("stop requested {}: {reason}", uptime(live)),
        ));
    }

    /// What the supervisor does after an abnormal exit.
    pub(super) fn log_supervisor(&self, tool: Tool, launch_id: &str, what: &str) {
        self.events.write(&line(tool, launch_id, what));
    }

    /// The child is gone. `expected` is true when a stop asked for it; otherwise it is an abnormal
    /// exit.
    pub(super) fn log_exited(&self, tool: Tool, launch_id: &str, expected: bool, detail: &str) {
        let what = if expected {
            format!("ended after a stop: {detail}")
        } else {
            format!("exited abnormally: {detail}")
        };
        self.events.write(&line(tool, launch_id, &what));
    }
}
