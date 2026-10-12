//! Assets and request support for the remote board and monitor surfaces.

pub mod assets;

use std::collections::HashSet;
use std::sync::Arc;

use crate::error::AgboardError;
use crate::server::AppState;
use crate::server::monitor::{MonitorState, router as monitor_router};
use axum::Router;

/// The opt-in HTTPS reverse-proxy listener. Origins are canonical HTTPS origins
/// (scheme and authority only); their authorities are the only proxy Host values
/// accepted in addition to the listener's own loopback authority.
pub(crate) fn router(
    app: Arc<AppState>,
    port: u16,
    origins: &[String],
    remote_token: String,
) -> Result<Router, AgboardError> {
    let mut allowed_origins = HashSet::new();
    let mut authorities = HashSet::new();
    authorities.insert(format!("127.0.0.1:{port}"));
    for origin in origins {
        let (origin, authority) =
            super::api::canonical_https_origin(origin).ok_or_else(|| invalid_origin(origin))?;
        allowed_origins.insert(origin);
        authorities.insert(authority);
    }
    if allowed_origins.is_empty() {
        return Err(invalid_origin("(none)"));
    }
    let authorities = Arc::new(authorities);
    let guard = super::api::RemoteGuard {
        port,
        origins: Arc::new(allowed_origins),
        authorities: authorities.clone(),
        token: remote_token,
    };
    let monitor_token = crate::server::assets::new_token()?;
    let monitor = Arc::new(MonitorState::new(
        app.shared.clone(),
        app.index.clone(),
        app.changed.clone(),
        authorities.as_ref().clone(),
    ));
    let monitor_write_guard = super::api::RemoteGuard {
        token: monitor_token,
        ..guard.clone()
    };
    Ok(super::api::remote_router(app.clone(), guard)
        .merge(monitor_router(monitor))
        .merge(crate::server::monitor::write_router(
            app,
            monitor_write_guard,
        )))
}

fn invalid_origin(origin: &str) -> AgboardError {
    AgboardError::InvalidArgument {
        message: format!("Invalid remote HTTPS origin: {origin}"),
        command: Some("serve".to_string()),
    }
}
