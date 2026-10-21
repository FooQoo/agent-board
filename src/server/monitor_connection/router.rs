//! The dedicated loopback entry the ngrok forwarder talks to.
//!
//! Until the tunnel's policy and public origin are known the gate is empty and
//! every request is refused. Once they are known a request must still carry the
//! public Host and exactly one correct proof ([`admit`]); what happens after
//! that (the session, CSRF and routing) is in [`super::entry`].

use std::sync::{Arc, RwLock};

use axum::Router;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::Response;
use tokio::sync::watch;

use super::contracts::{ContractError, PublicOrigin, TunnelProof};
use crate::server::monitor_auth::session::SessionStore;

/// What the backend needs to know about the running tunnel.
#[derive(Clone)]
pub struct BackendPolicy {
    pub proof: TunnelProof,
    pub origin: PublicOrigin,
    /// The start generation that issued this policy; sessions are bound to it.
    pub epoch: u64,
    /// Application sessions of this run. Dropped with the policy.
    pub sessions: Arc<SessionStore>,
    /// Added to a request that has passed every check, for the existing write guard.
    pub internal_token: Arc<str>,
    revoked: Arc<watch::Sender<bool>>,
}

impl BackendPolicy {
    pub fn new(
        proof: TunnelProof,
        origin: PublicOrigin,
        epoch: u64,
        sessions: Arc<SessionStore>,
        internal_token: String,
    ) -> Self {
        Self {
            proof,
            origin,
            epoch,
            sessions,
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
    /// The Host or proof check failed.
    Contract(ContractError),
}

/// The Host and proof checks every request must pass first.
pub fn admit(policy: Option<&BackendPolicy>, headers: &HeaderMap) -> Result<(), Refusal> {
    let policy = policy.ok_or(Refusal::NotReady)?;
    policy
        .origin
        .check_host(headers)
        .map_err(Refusal::Contract)?;
    policy.proof.verify(headers).map_err(Refusal::Contract)
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
    use crate::server::monitor_auth::session::system_clock;
    use axum::http::{HeaderName, HeaderValue};

    fn policy() -> BackendPolicy {
        BackendPolicy::new(
            TunnelProof::from_bytes(&[9u8; 32]),
            PublicOrigin::parse("https://abc.ngrok.app").unwrap(),
            1,
            Arc::new(SessionStore::new(system_clock(), 60)),
            "internal".into(),
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
    fn the_host_and_exactly_one_proof_are_required() {
        let p = policy();
        let good = headers(&[
            ("host", "abc.ngrok.app"),
            ("x-agboard-tunnel-proof", &"09".repeat(32)),
        ]);
        assert_eq!(admit(None, &good), Err(Refusal::NotReady));
        assert_eq!(admit(Some(&p), &good), Ok(()));
        assert_eq!(
            admit(Some(&p), &headers(&[("host", "abc.ngrok.app")])),
            Err(Refusal::Contract(ContractError::ProofMissing))
        );
        assert_eq!(
            admit(
                Some(&p),
                &headers(&[
                    ("host", "127.0.0.1:1"),
                    ("x-agboard-tunnel-proof", &"09".repeat(32))
                ])
            ),
            Err(Refusal::Contract(ContractError::HostMismatch))
        );
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
