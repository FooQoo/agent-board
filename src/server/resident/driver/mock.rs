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

struct State {
    script: VecDeque<Step>,
    stopped: bool,
}

pub struct MockDriver {
    state: Mutex<State>,
    changed: Condvar,
    calls: Calls,
    idle: AtomicBool,
    /// The steps the session plays after each message it receives, as a CLI would answer it.
    reply: Vec<Step>,
}

impl MockDriver {
    /// A session that plays `reply` after every message sent to it.
    pub fn replying(script: Vec<Step>, reply: Vec<Step>, calls: Calls) -> MockDriver {
        MockDriver {
            state: Mutex::new(State {
                script: script.into(),
                stopped: false,
            }),
            changed: Condvar::new(),
            calls,
            idle: AtomicBool::new(false),
            reply,
        }
    }

    fn record(&self, call: Call) {
        self.calls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(call);
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
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
        self.idle.load(Ordering::SeqCst) && !self.state().stopped
    }

    fn next_event(&self) -> DriverEvent {
        loop {
            let mut state = self.state();
            if let Some(step) = state.script.pop_front() {
                drop(state);
                match step {
                    Step::Event(event) => {
                        match &event {
                            DriverEvent::TurnEnded(_) => self.idle.store(true, Ordering::SeqCst),
                            DriverEvent::Started { .. } => self.idle.store(false, Ordering::SeqCst),
                            _ => {}
                        }
                        return event;
                    }
                    Step::Sleep(pause) => std::thread::sleep(pause),
                }
                continue;
            }
            if state.stopped {
                return DriverEvent::Exited {
                    code: None,
                    signal: Some(15),
                };
            }
            let _woken = self
                .changed
                .wait_while(state, |state| state.script.is_empty() && !state.stopped)
                .unwrap_or_else(|e| e.into_inner());
        }
    }

    fn send_user_message(&self, text: &str) -> Result<(), AgboardError> {
        self.record(Call::Send(text.to_string()));
        self.idle.store(false, Ordering::SeqCst);
        self.state().script.extend(self.reply.clone());
        self.changed.notify_all();
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
        self.state().stopped = true;
        self.changed.notify_all();
    }
}

/// A factory whose every driver plays `script`, and the calls all of them receive.
pub fn factory(script: Vec<Step>) -> (DriverFactory, Calls) {
    factory_replying(script, Vec::new())
}

/// [`factory`] for drivers that also play `reply` after every message they receive.
pub fn factory_replying(script: Vec<Step>, reply: Vec<Step>) -> (DriverFactory, Calls) {
    let calls: Calls = Arc::new(Mutex::new(Vec::new()));
    let shared = calls.clone();
    let make: DriverFactory = Arc::new(move |_, _| {
        Box::new(MockDriver::replying(
            script.clone(),
            reply.clone(),
            shared.clone(),
        ))
    });
    (make, calls)
}
