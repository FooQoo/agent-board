//! `MockDriver`, a scripted implementation of `AgentDriver` for tests of the launcher: it hands
//! out the scripted events one by one, records every call it receives so a test can check them
//! afterwards, and ends when it is stopped.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use super::{AgentDriver, DriverEvent, DriverFactory, PermissionAnswer, StartSpec};
use crate::error::AgboardError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Call {
    Start {
        prompt: String,
        env: Vec<(String, String)>,
    },
    Send(String),
    Answer {
        id: String,
        answer: PermissionAnswer,
    },
    Interrupt,
    Stop,
}

/// One step of a script.
#[derive(Debug, Clone)]
pub enum Step {
    Event(DriverEvent),
    /// Pause before the next step.
    Sleep(Duration),
}

pub type Calls = Arc<Mutex<Vec<Call>>>;

pub struct MockDriver {
    script: Mutex<VecDeque<Step>>,
    calls: Calls,
    stopped: Mutex<bool>,
    changed: Condvar,
    idle: AtomicBool,
}

impl MockDriver {
    pub fn new(script: Vec<Step>, calls: Calls) -> MockDriver {
        MockDriver {
            script: Mutex::new(script.into()),
            calls,
            stopped: Mutex::new(false),
            changed: Condvar::new(),
            idle: AtomicBool::new(false),
        }
    }

    fn record(&self, call: Call) {
        self.calls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(call);
    }
}

impl AgentDriver for MockDriver {
    fn start(&self, spec: StartSpec) -> Result<(), AgboardError> {
        self.record(Call::Start {
            prompt: spec.prompt,
            env: spec.env,
        });
        Ok(())
    }

    fn pid(&self) -> Option<u32> {
        Some(4_000_000)
    }

    fn is_idle(&self) -> bool {
        self.idle.load(Ordering::SeqCst) && !*self.stopped.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn next_event(&self) -> DriverEvent {
        loop {
            let step = self
                .script
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .pop_front();
            match step {
                Some(Step::Event(event)) => {
                    match &event {
                        DriverEvent::TurnEnded(_) => self.idle.store(true, Ordering::SeqCst),
                        DriverEvent::Started { .. } => self.idle.store(false, Ordering::SeqCst),
                        _ => {}
                    }
                    return event;
                }
                Some(Step::Sleep(pause)) => std::thread::sleep(pause),
                None => {
                    let stopped = self.stopped.lock().unwrap_or_else(|e| e.into_inner());
                    let _held = self
                        .changed
                        .wait_while(stopped, |stopped| !*stopped)
                        .unwrap_or_else(|e| e.into_inner());
                    return DriverEvent::Exited {
                        code: None,
                        signal: Some(15),
                    };
                }
            }
        }
    }

    fn send_user_message(&self, text: &str) -> Result<(), AgboardError> {
        self.record(Call::Send(text.to_string()));
        self.idle.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn answer_permission(&self, id: &str, answer: PermissionAnswer) -> Result<(), AgboardError> {
        self.record(Call::Answer {
            id: id.to_string(),
            answer,
        });
        Ok(())
    }

    fn interrupt(&self) -> Result<(), AgboardError> {
        self.record(Call::Interrupt);
        Ok(())
    }

    fn stop(&self, _grace: Duration) {
        self.record(Call::Stop);
        *self.stopped.lock().unwrap_or_else(|e| e.into_inner()) = true;
        self.changed.notify_all();
    }
}

/// A factory whose every driver plays `script`, and the calls all of them receive.
pub fn factory(script: Vec<Step>) -> (DriverFactory, Calls) {
    let calls: Calls = Arc::new(Mutex::new(Vec::new()));
    let shared = calls.clone();
    let make: DriverFactory =
        Arc::new(move |_, _| Box::new(MockDriver::new(script.clone(), shared.clone())));
    (make, calls)
}
