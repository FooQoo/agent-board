//! The dedicated loopback entry the ngrok forwarder talks to.
//!
//! Until the tunnel's policy and public origin are known the gate is empty and
//! every request is refused. Once they are known a request must still carry the
//! public Host ([`admit`]); what happens after that (the passcode, the session,
//! CSRF and routing) is in [`super::entry`].

use std::sync::{Arc, RwLock};

use axum::Router;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::Response;
use tokio::sync::watch;

use super::contracts::{ContractError, PublicOrigin};
use crate::server::monitor_auth::passcode::UnlockGate;
use crate::server::monitor_auth::session::SessionStore;

/// What the backend needs to know about the running tunnel.
#[derive(Clone)]
pub struct BackendPolicy {
    pub origin: PublicOrigin,
    /// The start generation that issued this policy; sessions are bound to it.
    pub epoch: u64,
    /// Application sessions of this run. Dropped with the policy.
    pub sessions: Arc<SessionStore>,
    /// The passcode of this run and the count of wrong guesses against it.
    pub unlock: Arc<UnlockGate>,
    /// Added to a request that has passed every check, for the existing write guard.
    pub internal_token: Arc<str>,
    revoked: Arc<watch::Sender<bool>>,
}

impl BackendPolicy {
    pub fn new(
        origin: PublicOrigin,
        epoch: u64,
        sessions: Arc<SessionStore>,
        internal_token: String,
        unlock: Arc<UnlockGate>,
    ) -> Self {
        Self {
            origin,
            epoch,
            sessions,
            unlock,
            internal_token: internal_token.into(),
            revoked: Arc::new(watch::channel(false).0),
        }
    }

    /// Ends open streams of this run. Called when the run is closed.
    pub fn revoke(&self) {
        self.revoked.send_replace(true);
    }

    /// Completes once the run is closed (or the policy is gone).
    pub fn revocation(&self) -> watch::Receiver<bool> {
        self.revoked.subscribe()
    }
}

/// Shared by the supervisor (which fills it) and the router (which reads it).
pub type Gate = Arc<RwLock<Option<BackendPolicy>>>;

/// Why a request was not admitted.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// No tunnel policy yet: the backend admits nothing.
    NotReady,
    /// The Host check failed.
    Contract(ContractError),
}

/// The Host check every request must pass first: `Host` equals the public
/// address ngrok returned, exactly. The Edge adds nothing for the app to check;
/// who may read is decided by the passcode and the session behind this.
pub fn admit(policy: Option<&BackendPolicy>, headers: &HeaderMap) -> Result<(), Refusal> {
    let policy = policy.ok_or(Refusal::NotReady)?;
    policy.origin.check_host(headers).map_err(Refusal::Contract)
}

/// Remove the policy of a closed run: nothing is admitted afterwards and open
/// streams end.
pub fn close_gate(gate: &Gate) {
    let policy = gate.write().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(policy) = policy {
        policy.revoke();
    }
}

/// The answer to every refused request. The reason is deliberately not sent.
pub fn refuse() -> Response {
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONNECTION, "close")
        .body(axum::body::Body::from(
            r#"{"error":{"code":"forbidden","message":"request is not allowed.","reason":"not available"}}"#,
        ))
        .unwrap_or_default()
}

/// Serves while the tunnel is not ready: refuses everything and closes the connection.
pub fn backend_router(gate: Gate) -> Router {
    Router::new().fallback(refuse_all).with_state(gate)
}

async fn refuse_all(State(gate): State<Gate>, request: Request) -> Response {
    let policy = gate.read().unwrap_or_else(|e| e.into_inner()).clone();
    let _ = admit(policy.as_ref(), request.headers());
    refuse()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::monitor_auth::passcode::Passcode;
    use crate::server::monitor_auth::session::system_clock;
    use axum::http::{HeaderName, HeaderValue};

    fn policy() -> BackendPolicy {
        BackendPolicy::new(
            PublicOrigin::parse("https://abc.ngrok.app").unwrap(),
            1,
            Arc::new(SessionStore::new(system_clock(), 60)),
            "internal".into(),
            Arc::new(UnlockGate::new(Passcode::from_number(1234))),
        )
    }

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.append(
                HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        h
    }

    #[test]
    fn only_the_exact_public_host_is_admitted() {
        let p = policy();
        let good = headers(&[("host", "abc.ngrok.app")]);
        // Before the tunnel's address is known nothing is admitted.
        assert_eq!(admit(None, &good), Err(Refusal::NotReady));
        assert_eq!(admit(Some(&p), &good), Ok(()));
        for bad in [
            headers(&[]),
            headers(&[("host", "127.0.0.1:1")]),
            headers(&[("host", "localhost")]),
            headers(&[("host", "abc.ngrok.app:443")]),
            headers(&[("host", "evil.ngrok.app")]),
            headers(&[("host", "abc.ngrok.app"), ("host", "abc.ngrok.app")]),
        ] {
            assert_eq!(
                admit(Some(&p), &bad),
                Err(Refusal::Contract(ContractError::HostMismatch)),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn closing_the_gate_revokes_the_policy() {
        let gate: Gate = Arc::new(RwLock::new(Some(policy())));
        let rx = gate.read().unwrap().as_ref().unwrap().revocation();
        close_gate(&gate);
        assert!(gate.read().unwrap().is_none());
        assert!(*rx.borrow());
    }
}
