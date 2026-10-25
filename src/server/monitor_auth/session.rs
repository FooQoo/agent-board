//! The in-memory store of application sessions for the ngrok monitor entrance.
//!
//! Nothing here is written to disk. The store keeps only digests of the session
//! secret and the CSRF token. The CSRF token of a session is derived from its
//! secret, so a page that asks again (another tab, a reconnect) gets the same
//! token without the store ever holding the raw value.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::contracts::{AuthSession, SESSION_MAX_AGE_SECS, SessionRejection, secret_hash};

/// The most sessions held at once; the one closest to expiring goes first.
const MAX_SESSIONS: usize = 256;

/// Seconds since the Unix epoch. Tests replace it to move time.
pub type Clock = Arc<dyn Fn() -> u64 + Send + Sync>;

pub fn system_clock() -> Clock {
    Arc::new(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs())
    })
}

/// The raw values handed to the browser once. Never log them.
pub struct IssuedSession {
    pub secret: String,
    pub csrf: String,
    pub expires_at: u64,
}

pub struct SessionStore {
    sessions: Mutex<HashMap<String, AuthSession>>,
    clock: Clock,
    ttl_secs: u64,
}

/// The CSRF token that belongs to a session secret.
pub fn csrf_for(secret: &str) -> String {
    secret_hash(&format!("agboard-csrf:{secret}"))
}

impl SessionStore {
    /// A store whose sessions last `ttl_secs`, never more than twelve hours.
    pub fn new(clock: Clock, ttl_secs: u64) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            clock,
            ttl_secs: ttl_secs.min(SESSION_MAX_AGE_SECS),
        }
    }

    pub fn now(&self) -> u64 {
        (self.clock)()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, AuthSession>> {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Start a session for this public origin and start generation.
    pub fn issue(&self, origin: &str, epoch: u64) -> std::io::Result<IssuedSession> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
        let secret: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let csrf = csrf_for(&secret);
        let now = self.now();
        let session = AuthSession::issue(&secret, &csrf, origin, epoch, now, self.ttl_secs);
        let expires_at = session.expires_at;
        let mut sessions = self.lock();
        sessions.retain(|_, s| s.expires_at > now);
        if sessions.len() >= MAX_SESSIONS
            && let Some(oldest) = sessions
                .iter()
                .min_by_key(|(_, s)| s.expires_at)
                .map(|(k, _)| k.clone())
        {
            sessions.remove(&oldest);
        }
        sessions.insert(session.session_hash.clone(), session);
        Ok(IssuedSession {
            secret,
            csrf,
            expires_at,
        })
    }

    /// The session behind a cookie value, if it is still valid for this
    /// generation and public origin. An expired one is forgotten.
    pub fn check(
        &self,
        secret: &str,
        epoch: u64,
        origin: &str,
    ) -> Result<AuthSession, SessionRejection> {
        let key = secret_hash(secret);
        let mut sessions = self.lock();
        let session = sessions
            .get(&key)
            .cloned()
            .ok_or(SessionRejection::UnknownSession)?;
        match session.validate(secret, epoch, origin, self.now()) {
            Ok(()) => Ok(session),
            Err(rejection) => {
                if rejection == SessionRejection::Expired {
                    sessions.remove(&key);
                }
                Err(rejection)
            }
        }
    }

    pub fn revoke(&self, secret: &str) {
        self.lock().remove(&secret_hash(secret));
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    const ORIGIN: &str = "https://a.ngrok.app";

    fn store(now: &Arc<AtomicU64>, ttl: u64) -> SessionStore {
        let now = now.clone();
        SessionStore::new(Arc::new(move || now.load(Ordering::SeqCst)), ttl)
    }

    #[test]
    fn a_session_lasts_at_most_twelve_hours_and_then_is_forgotten() {
        let now = Arc::new(AtomicU64::new(1_000));
        let s = store(&now, u64::MAX);
        let issued = s.issue(ORIGIN, 4).unwrap();
        assert_eq!(issued.expires_at, 1_000 + SESSION_MAX_AGE_SECS);
        now.store(1_000 + SESSION_MAX_AGE_SECS - 1, Ordering::SeqCst);
        assert!(s.check(&issued.secret, 4, ORIGIN).is_ok());
        now.store(1_000 + SESSION_MAX_AGE_SECS, Ordering::SeqCst);
        assert_eq!(
            s.check(&issued.secret, 4, ORIGIN).unwrap_err(),
            SessionRejection::Expired
        );
        assert_eq!(
            s.check(&issued.secret, 4, ORIGIN).unwrap_err(),
            SessionRejection::UnknownSession
        );
        assert!(s.is_empty());
    }

    #[test]
    fn a_session_is_bound_to_its_generation_and_origin() {
        let now = Arc::new(AtomicU64::new(0));
        let s = store(&now, 60);
        let issued = s.issue(ORIGIN, 4).unwrap();
        assert_eq!(
            s.check(&issued.secret, 5, ORIGIN).unwrap_err(),
            SessionRejection::StaleEpoch
        );
        assert_eq!(
            s.check(&issued.secret, 4, "https://b.ngrok.app")
                .unwrap_err(),
            SessionRejection::OriginMismatch
        );
        assert!(s.check("not-a-session", 4, ORIGIN).is_err());
    }

    #[test]
    fn the_csrf_token_is_stable_for_a_session_and_checked_by_digest() {
        let now = Arc::new(AtomicU64::new(0));
        let s = store(&now, 60);
        let issued = s.issue(ORIGIN, 1).unwrap();
        assert_eq!(csrf_for(&issued.secret), issued.csrf);
        let session = s.check(&issued.secret, 1, ORIGIN).unwrap();
        assert!(session.csrf_matches(&issued.csrf));
        assert!(!session.csrf_matches(&issued.secret));
        assert_ne!(issued.csrf, issued.secret);
        assert_eq!(issued.secret.len(), 64);
    }

    #[test]
    fn revoking_ends_a_session_and_the_store_stays_bounded() {
        let now = Arc::new(AtomicU64::new(0));
        let s = store(&now, 60);
        let one = s.issue(ORIGIN, 1).unwrap();
        s.revoke(&one.secret);
        assert!(s.check(&one.secret, 1, ORIGIN).is_err());
        for _ in 0..MAX_SESSIONS + 10 {
            s.issue(ORIGIN, 1).unwrap();
        }
        assert_eq!(s.len(), MAX_SESSIONS);
    }
}
