//! Types for the temporary, in-memory session that the ngrok monitor entrance issues.
//!
//! Sessions and CSRF tokens are never written to disk. Only
//! their SHA-256 digests are kept in memory so a memory dump of the store does
//! not reveal a usable cookie.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Maximum lifetime of an application session, in seconds (12 hours).
pub const SESSION_MAX_AGE_SECS: u64 = 12 * 60 * 60;

/// Name of the application session cookie. Scoped to `/monitor/`.
pub const SESSION_COOKIE_NAME: &str = "agboard_ngrok_session";

/// The attributes the session cookie must carry.
pub const SESSION_COOKIE_ATTRIBUTES: &str = "Secure; HttpOnly; SameSite=Lax; Path=/monitor/";

/// Hex SHA-256 of a secret value such as a session id or CSRF token.
pub fn secret_hash(secret: &str) -> String {
    let digest = Sha256::digest(secret.as_bytes());
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Constant-time equality for two byte strings of any length.
///
/// Both inputs are hashed first so the comparison time does not depend on where
/// they differ or on their lengths.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let ha = Sha256::digest(a);
    let hb = Sha256::digest(b);
    let mut diff = 0u8;
    for (x, y) in ha.iter().zip(hb.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// One application session. Held in memory only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    /// Hex SHA-256 of the session cookie value.
    pub session_hash: String,
    /// Hex SHA-256 of the CSRF token.
    pub csrf_hash: String,
    /// Public HTTPS origin the session was issued for.
    pub origin: String,
    /// Start generation of the process or tunnel that issued the session.
    pub epoch: u64,
    /// Unix seconds after which the session is no longer valid.
    pub expires_at: u64,
}

/// Why a session was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionRejection {
    /// The cookie value does not match.
    UnknownSession,
    /// The session was issued by an earlier start generation.
    StaleEpoch,
    /// The session was issued for a different public origin.
    OriginMismatch,
    /// The session lifetime has passed.
    Expired,
}

impl AuthSession {
    /// Build a session from the raw secrets, storing only their digests.
    ///
    /// The lifetime is capped at [`SESSION_MAX_AGE_SECS`].
    pub fn issue(
        session_secret: &str,
        csrf_secret: &str,
        origin: &str,
        epoch: u64,
        now: u64,
        ttl_secs: u64,
    ) -> Self {
        Self {
            session_hash: secret_hash(session_secret),
            csrf_hash: secret_hash(csrf_secret),
            origin: origin.to_string(),
            epoch,
            expires_at: now.saturating_add(ttl_secs.min(SESSION_MAX_AGE_SECS)),
        }
    }

    /// Check the session against the current epoch, origin and time.
    pub fn validate(
        &self,
        session_secret: &str,
        current_epoch: u64,
        current_origin: &str,
        now: u64,
    ) -> Result<(), SessionRejection> {
        if !constant_time_eq(
            self.session_hash.as_bytes(),
            secret_hash(session_secret).as_bytes(),
        ) {
            return Err(SessionRejection::UnknownSession);
        }
        if self.epoch != current_epoch {
            return Err(SessionRejection::StaleEpoch);
        }
        if self.origin != current_origin {
            return Err(SessionRejection::OriginMismatch);
        }
        if now >= self.expires_at {
            return Err(SessionRejection::Expired);
        }
        Ok(())
    }

    /// Check a CSRF token presented with a state-changing request.
    pub fn csrf_matches(&self, csrf_secret: &str) -> bool {
        constant_time_eq(
            self.csrf_hash.as_bytes(),
            secret_hash(csrf_secret).as_bytes(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: &str = "https://example.ngrok.app";

    fn session() -> AuthSession {
        AuthSession::issue("sess", "csrf", ORIGIN, 3, 1_000, 60)
    }

    #[test]
    fn stores_digests_not_secrets() {
        let s = session();
        assert_ne!(s.session_hash, "sess");
        assert_eq!(s.session_hash.len(), 64);
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("\"sess\"") && !json.contains("\"csrf\""));
        assert!(json.contains("sessionHash") && json.contains("csrfHash"));
        assert!(json.contains("expiresAt"));
    }

    #[test]
    fn accepts_a_current_session() {
        assert_eq!(session().validate("sess", 3, ORIGIN, 1_059), Ok(()));
        assert!(session().csrf_matches("csrf"));
        assert!(!session().csrf_matches("other"));
    }

    #[test]
    fn rejects_unknown_stale_foreign_and_expired_sessions() {
        let s = session();
        assert_eq!(
            s.validate("nope", 3, ORIGIN, 1_001),
            Err(SessionRejection::UnknownSession)
        );
        assert_eq!(
            s.validate("sess", 4, ORIGIN, 1_001),
            Err(SessionRejection::StaleEpoch)
        );
        assert_eq!(
            s.validate("sess", 3, "https://other.ngrok.app", 1_001),
            Err(SessionRejection::OriginMismatch)
        );
        assert_eq!(
            s.validate("sess", 3, ORIGIN, 1_060),
            Err(SessionRejection::Expired)
        );
    }

    #[test]
    fn lifetime_is_capped_at_twelve_hours() {
        let s = AuthSession::issue("a", "b", ORIGIN, 1, 0, u64::MAX);
        assert_eq!(s.expires_at, SESSION_MAX_AGE_SECS);
    }

    #[test]
    fn constant_time_eq_handles_length_differences() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"", b"a"));
    }
}
