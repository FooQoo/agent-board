//! The loopback backend of the tunnel: a listener that can change hands from
//! the refusing router to the real one, and the router built once the public
//! origin is known.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::serve::Listener;
use tokio::net::{TcpListener, TcpStream};
use tokio::task::AbortHandle;

use super::contracts::PublicOrigin;
use super::entry::{LOGO_PATH, external_router};
use super::router::Gate;
use crate::error::AgboardError;
use crate::server::AppState;
use crate::server::guard::BoardWriteGuard;
use crate::server::monitor::{MonitorState, router as monitor_router, write_router};

/// One bound socket that two `axum::serve` calls take in turn.
#[derive(Clone)]
pub(super) struct SharedListener(pub Arc<TcpListener>);

impl Listener for SharedListener {
    type Io = TcpStream;
    type Addr = std::net::SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            match self.0.accept().await {
                Ok(connection) => return connection,
                Err(_) => tokio::time::sleep(Duration::from_millis(5)).await,
            }
        }
    }

    fn local_addr(&self) -> std::io::Result<Self::Addr> {
        self.0.local_addr()
    }
}

/// Serve `app` on the shared socket until the returned task is aborted.
pub(super) fn serve(listener: &SharedListener, app: Router) -> AbortHandle {
    let listener = listener.clone();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    })
    .abort_handle()
}

/// The monitor behind the entry checks, for this public origin. The existing
/// read-only and answer routers are reused; they only ever see requests that
/// the entry has authenticated.
pub(super) fn external_app(
    app: &Arc<AppState>,
    origin: &PublicOrigin,
    internal_token: String,
    gate: Gate,
) -> Router {
    let authorities: HashSet<String> = HashSet::from([origin.authority().to_string()]);
    let monitor = Arc::new(MonitorState::new(
        app.shared.clone(),
        app.index.clone(),
        app.changed.clone(),
        authorities.clone(),
    ));
    let guard = BoardWriteGuard {
        origins: Arc::new(HashSet::from([origin.origin().to_string()])),
        authorities: Arc::new(authorities),
        token: internal_token,
    };
    let inner = monitor_router(monitor)
        .merge(write_router(app.clone(), guard))
        .route(LOGO_PATH, get(logo));
    external_router(gate, inner)
}

/// The header logo the page asks for, from the build already embedded in the binary.
async fn logo() -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/png"),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        crate::server::assets::LOGO_WHITE_PNG,
    )
        .into_response()
}

/// A fresh random token, for the guard that sits behind the entry.
pub(super) fn internal_token() -> Result<String, AgboardError> {
    crate::server::assets::new_token()
}
