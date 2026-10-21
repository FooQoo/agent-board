//! The ngrok SDK entry point: one session and one forwarded HTTP endpoint.

use ngrok::prelude::*;
use thiserror::Error;
use url::Url;

use super::PublicOrigin;

/// Errors from opening the endpoint. Messages never include the token.
#[derive(Debug, Error)]
pub enum EndpointError {
    #[error("could not connect to ngrok: {0}")]
    Connect(String),
    #[error("could not open the ngrok endpoint: {0}")]
    Listen(String),
    #[error("ngrok returned an unusable public URL")]
    PublicUrl,
}

/// A running session and its forwarder to the loopback backend.
pub struct OpenEndpoint {
    pub session: ngrok::Session,
    pub forwarder: ngrok::forwarder::Forwarder<ngrok::tunnel::HttpTunnel>,
    pub public: PublicOrigin,
}

/// Connect a session and open an HTTP endpoint that forwards to `backend`.
///
/// Runs on the caller's Tokio runtime and starts no child process. No Traffic
/// Policy is set and no domain is asked for: ngrok chooses the public address,
/// so a plan without Traffic Policy or a reserved domain can run it. The Host
/// header is not rewritten, so the backend sees the public authority.
/// `server_addr` overrides the ngrok server address (used only by tests).
pub async fn open_endpoint(
    authtoken: &str,
    backend: Url,
    server_addr: Option<&str>,
) -> Result<OpenEndpoint, EndpointError> {
    let mut builder = ngrok::Session::builder();
    builder.authtoken(authtoken);
    if let Some(addr) = server_addr {
        builder
            .server_addr(addr)
            .map_err(|e| EndpointError::Connect(e.to_string()))?;
    }
    let session = builder
        .connect()
        .await
        .map_err(|e| EndpointError::Connect(e.to_string()))?;
    let mut endpoint = session.http_endpoint();
    endpoint.host_header_rewrite(false);
    let forwarder = endpoint
        .listen_and_forward(backend)
        .await
        .map_err(|e| EndpointError::Listen(e.to_string()))?;
    let public = PublicOrigin::parse(forwarder.url()).map_err(|_| EndpointError::PublicUrl)?;
    Ok(OpenEndpoint {
        session,
        forwarder,
        public,
    })
}
