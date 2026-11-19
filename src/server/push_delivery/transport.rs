//! Posting an encrypted message to a push service.
//!
//! [`PushTransport`] is the one place that touches the network, so the delivery logic can be
//! driven by a fake in tests. The real one follows no redirect and gives up after a few
//! seconds, so a slow or hostile push service cannot hold the board.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use sha2::{Digest, Sha256};

/// How long the push service keeps a message for a phone that is off: one day.
pub(super) const TTL_SECONDS: u32 = 24 * 60 * 60;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// One POST to a push service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub endpoint: String,
    /// `vapid t=<jwt>, k=<public key>`.
    pub authorization: String,
    pub ttl: u32,
    /// `high` for a message that needs an answer, `normal` otherwise.
    pub urgency: &'static str,
    /// Names the event, so a push service that holds an undelivered message replaces it.
    pub topic: String,
    pub body: Vec<u8>,
}

/// The `Topic` header for a tag: up to 32 URL-safe characters, with nothing of the tag in it.
pub(super) fn topic_of(tag: &str) -> String {
    let mut name = B64.encode(Sha256::digest(tag.as_bytes()));
    name.truncate(32);
    name
}

/// What the push service answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Accepted for delivery.
    Delivered,
    /// The subscription no longer exists (404 or 410): forget it.
    Gone,
    /// Not now (429, a 5xx, or no answer): try again later.
    Retry,
    /// Refused for a reason that waiting does not fix.
    Rejected,
}

pub type SendFuture = Pin<Box<dyn Future<Output = Outcome> + Send>>;

pub trait PushTransport: Send + Sync {
    fn send(&self, request: Request) -> SendFuture;
}

/// Posts with `reqwest` over TLS.
pub struct HttpTransport {
    client: reqwest::Client,
}

impl Default for HttpTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpTransport {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_default();
        Self { client }
    }
}

pub(super) fn outcome_of(status: u16) -> Outcome {
    match status {
        200..=299 => Outcome::Delivered,
        404 | 410 => Outcome::Gone,
        408 | 425 | 429 | 500..=599 => Outcome::Retry,
        _ => Outcome::Rejected,
    }
}

impl PushTransport for HttpTransport {
    fn send(&self, request: Request) -> SendFuture {
        let client = self.client.clone();
        Box::pin(async move {
            let response = client
                .post(&request.endpoint)
                .header("Authorization", request.authorization)
                .header("TTL", request.ttl.to_string())
                .header("Urgency", request.urgency)
                .header("Topic", request.topic)
                .header("Content-Encoding", "aes128gcm")
                .header("Content-Type", "application/octet-stream")
                .body(request.body)
                .send()
                .await;
            match response {
                Ok(r) => outcome_of(r.status().as_u16()),
                Err(_) => Outcome::Retry,
            }
        })
    }
}

#[cfg(test)]
mod tests;
