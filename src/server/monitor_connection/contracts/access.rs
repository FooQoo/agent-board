//! The per-start tunnel proof and the public Origin/Host checks.

use std::fmt;

use axum::http::{HeaderMap, HeaderName};
use url::Url;

use super::{ContractError, PROOF_HEADER};
use crate::server::monitor_auth::contracts::{constant_time_eq, secret_hash};

#[derive(Clone, PartialEq, Eq)]
pub struct TunnelProof(String);

impl fmt::Debug for TunnelProof {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("TunnelProof(<redacted>)")
    }
}

impl TunnelProof {
    /// Generate a fresh proof from the operating system's random source.
    pub fn generate() -> std::io::Result<Self> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
        Ok(Self::from_bytes(&bytes))
    }

    /// Build a proof from 32 bytes (used by tests).
    pub fn from_bytes(bytes: &[u8; 32]) -> Self {
        let mut hex = String::with_capacity(64);
        for b in bytes {
            hex.push_str(&format!("{b:02x}"));
        }
        Self(hex)
    }

    /// The header value the Edge policy adds. Never log or return this.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// Digest suitable for logging that a proof exists, without revealing it.
    pub fn fingerprint(&self) -> String {
        secret_hash(&self.0)[..8].to_string()
    }

    /// Check the request headers: exactly one proof header equal to this proof.
    pub fn verify(&self, headers: &HeaderMap) -> Result<(), ContractError> {
        let name = HeaderName::from_static(PROOF_HEADER);
        let mut values = headers.get_all(&name).iter();
        let first = values.next().ok_or(ContractError::ProofMissing)?;
        if values.next().is_some() {
            return Err(ContractError::ProofDuplicate);
        }
        if constant_time_eq(first.as_bytes(), self.0.as_bytes()) {
            Ok(())
        } else {
            Err(ContractError::ProofMismatch)
        }
    }
}

/// The public HTTPS origin the SDK reports for the endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicOrigin {
    origin: String,
    authority: String,
}

impl PublicOrigin {
    /// Parse the endpoint URL. Only a bare `https://host[:port]` is accepted.
    pub fn parse(url: &str) -> Result<Self, ContractError> {
        let parsed = Url::parse(url).map_err(|_| ContractError::InvalidPublicUrl)?;
        let host = parsed.host_str().ok_or(ContractError::InvalidPublicUrl)?;
        if parsed.scheme() != "https"
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err(ContractError::InvalidPublicUrl);
        }
        let authority = match parsed.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_string(),
        };
        Ok(Self {
            origin: format!("https://{authority}"),
            authority,
        })
    }

    /// `https://host[:port]`.
    pub fn origin(&self) -> &str {
        &self.origin
    }

    /// `host[:port]`, the value the Host header must equal.
    pub fn authority(&self) -> &str {
        &self.authority
    }

    /// The Host header must equal the public authority exactly.
    pub fn check_host(&self, headers: &HeaderMap) -> Result<(), ContractError> {
        let mut values = headers.get_all(axum::http::header::HOST).iter();
        match (values.next(), values.next()) {
            (Some(v), None) if v.as_bytes() == self.authority.as_bytes() => Ok(()),
            _ => Err(ContractError::HostMismatch),
        }
    }

    /// A state-changing request must carry an Origin equal to the public origin.
    /// A missing, `null` or repeated Origin is refused.
    pub fn check_origin(&self, headers: &HeaderMap) -> Result<(), ContractError> {
        let mut values = headers.get_all(axum::http::header::ORIGIN).iter();
        match (values.next(), values.next()) {
            (Some(v), None) if v.as_bytes() == self.origin.as_bytes() => Ok(()),
            _ => Err(ContractError::OriginMismatch),
        }
    }
}
