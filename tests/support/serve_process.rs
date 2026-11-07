//! A child `agboard serve` that a failed test cannot leave behind.

use std::ops::{Deref, DerefMut};
use std::process::Child;

/// An `agboard serve` process that stops when this value is dropped, even if the
/// test panics first. Wrap the child as soon as it is spawned, so a failed
/// startup check is covered too.
pub struct ServeProcess(pub Child);

impl Deref for ServeProcess {
    type Target = Child;

    fn deref(&self) -> &Child {
        &self.0
    }
}

impl DerefMut for ServeProcess {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.0
    }
}

impl Drop for ServeProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
