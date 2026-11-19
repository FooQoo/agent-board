//! Web Push delivery of board changes to the phones that subscribed.
//!
//! A task of this module watches the server's change feed. After each change it compares what
//! a project's tasks show now with what they showed before ([`events`]), keeps the events the
//! saved notification settings want, folds the events of one task into the one that matters most,
//! and sends it, encrypted, to every subscribed device ([`deliver`], [`webpush`],
//! [`transport`]). A ledger records what each device was sent, so nothing is sent twice
//! ([`ledger`]); failures are tried again later with a growing wait. The board itself never
//! waits for any of this.
//!
//! Notifications carry links, so nothing is sent while the remote entrance is down.

mod deliver;
mod events;
mod ledger;
mod message;
mod runtime;
mod transport;
mod webpush;

pub(crate) use runtime::start;
pub use transport::{HttpTransport, Outcome, PushTransport, Request, SendFuture};
