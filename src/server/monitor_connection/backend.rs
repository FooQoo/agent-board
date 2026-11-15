//! The loopback backend of the tunnel: a listener that can change hands from
//! the refusing router to the real one, and the router built once the public
//! origin is known.

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::serve::Listener;
use tokio::net::{TcpListener, TcpStream};
use tokio::task::AbortHandle;

use super::entry::external_router;
use super::router::Gate;
use crate::server::AppState;
use crate::server::api::remote_router;

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

/// The board behind the entry checks, for this public origin. It only ever sees requests that the
/// entry has admitted: the page without a token, the board's API, the event stream, the project
/// docs and the guide, all at the same paths as on the PC.
pub(super) fn external_app(app: &Arc<AppState>, gate: Gate) -> Router {
    external_router(gate, remote_router(app.clone()))
}
