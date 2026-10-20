//! The dedicated loopback entry the ngrok forwarder talks to.
//!
//! Until the tunnel's policy and public origin are known the gate is empty and
//! every request is refused. Once they are known a request must still carry the
//! public Host and exactly one correct proof; the Google/session layer that
//! would admit it afterwards is not built yet, so nothing is admitted.
//!
//! To add the external monitor surface, replace the final `AuthUnavailable`
//! step of [`admit`] with the session check and routing; keep the earlier checks.

use std::sync::{Arc, RwLock};

use axum::Router;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::Response;

use super::contracts::{ContractError, PublicOrigin, TunnelProof};

/// What the backend needs to know about the running tunnel.
#[derive(Clone)]
pub struct BackendPolicy {
    pub proof: TunnelProof,
    pub origin: PublicOrigin,
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
    /// The request passed the entry checks but the external session layer is not built.
    AuthUnavailable,
}

/// Decide what to do with a request's headers. Always a refusal for now.
pub fn admit(policy: Option<&BackendPolicy>, headers: &HeaderMap) -> Refusal {
    let Some(policy) = policy else {
        return Refusal::NotReady;
    };
    if let Err(e) = policy.origin.check_host(headers) {
        return Refusal::Contract(e);
    }
    if let Err(e) = policy.proof.verify(headers) {
        return Refusal::Contract(e);
    }
    Refusal::AuthUnavailable
}

pub fn backend_router(gate: Gate) -> Router {
    Router::new().fallback(refuse).with_state(gate)
}

async fn refuse(State(gate): State<Gate>, request: Request) -> Response {
    let policy = gate.read().unwrap_or_else(|e| e.into_inner()).clone();
    // The reason is deliberately not sent: every refusal looks the same.
    let _reason = admit(policy.as_ref(), request.headers());
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(axum::body::Body::from(
            r#"{"error":{"code":"forbidden","message":"request is not allowed.","reason":"not available"}}"#,
        ))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderName, HeaderValue};

    fn policy() -> BackendPolicy {
        BackendPolicy {
            proof: TunnelProof::from_bytes(&[9u8; 32]),
            origin: PublicOrigin::parse("https://abc.ngrok.app").unwrap(),
        }
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
    fn nothing_is_admitted_even_with_the_right_host_and_proof() {
        let p = policy();
        let good = headers(&[
            ("host", "abc.ngrok.app"),
            ("x-agboard-tunnel-proof", &"09".repeat(32)),
        ]);
        assert_eq!(admit(None, &good), Refusal::NotReady);
        assert_eq!(admit(Some(&p), &good), Refusal::AuthUnavailable);
        assert_eq!(
            admit(Some(&p), &headers(&[("host", "abc.ngrok.app")])),
            Refusal::Contract(ContractError::ProofMissing)
        );
        assert_eq!(
            admit(
                Some(&p),
                &headers(&[
                    ("host", "127.0.0.1:1"),
                    ("x-agboard-tunnel-proof", &"09".repeat(32))
                ])
            ),
            Refusal::Contract(ContractError::HostMismatch)
        );
    }
}
