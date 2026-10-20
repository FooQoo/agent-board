//! Starting the tunnel: the loopback backend and the task that opens the endpoint.

use std::sync::{Arc, RwLock};

use tokio::sync::oneshot;
use url::Url;

use super::contracts::{
    ConnectionConfig, ConnectionStatus, ContractError, OauthApp, PolicyOauth, TunnelProof,
    build_traffic_policy,
};
use super::lifecycle::{Inner, MonitorConnections, Run};
use super::router::{BackendPolicy, Gate, backend_router};
use super::types::{FailureCode, OpenRequest, Secret, StartError};

impl MonitorConnections {
    /// Open a new loopback backend and request the tunnel. Runs under the lock;
    /// the tunnel itself is opened by a spawned task that re-checks the
    /// generation before it publishes anything.
    pub(super) fn begin(
        self: &Arc<Self>,
        inner: &mut Inner,
    ) -> Result<oneshot::Receiver<Result<String, FailureCode>>, StartError> {
        let config = ConnectionConfig {
            enabled: true,
            ..inner.config.clone()
        }
        .validated()
        .map_err(StartError::Invalid)?;
        let token = inner.token.clone().ok_or(StartError::TokenRequired)?;
        let oauth = match config.oauth_app {
            OauthApp::Managed => PolicyOauth::Managed,
            OauthApp::Custom => match &self.google {
                Some((id, secret)) => PolicyOauth::Custom {
                    client_id: id.expose().to_string(),
                    client_secret: secret.expose().to_string(),
                },
                None => {
                    return Err(StartError::Invalid(ContractError::MissingOauthCredentials));
                }
            },
        };
        let proof = TunnelProof::generate().map_err(|_| StartError::Internal)?;
        let policy = build_traffic_policy(&config.allow_emails, &proof, &oauth)
            .map_err(StartError::Invalid)?;

        self.teardown(inner);
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
            .and_then(|l| l.set_nonblocking(true).map(|()| l))
            .and_then(tokio::net::TcpListener::from_std)
            .map_err(|_| StartError::Internal)?;
        let port = listener
            .local_addr()
            .map_err(|_| StartError::Internal)?
            .port();
        let backend_url =
            Url::parse(&format!("http://127.0.0.1:{port}")).map_err(|_| StartError::Internal)?;
        let gate: Gate = Arc::new(RwLock::new(None));
        let backend = tokio::spawn({
            let app = backend_router(gate.clone());
            async move {
                let _ = axum::serve(listener, app).await;
            }
        })
        .abort_handle();

        inner.generation += 1;
        let generation = inner.generation;
        inner.status = ConnectionStatus::Starting;
        inner.url = None;
        inner.failure = None;
        let request = OpenRequest {
            token,
            policy: Secret::new(policy),
            backend: backend_url,
            domain: config.domain.clone(),
        };
        let (tx, rx) = oneshot::channel();
        let this = self.clone();
        let opening = self.connector.open(request);
        let opener = tokio::spawn(async move {
            let result = opening.await;
            let mut inner = this.lock();
            if inner.generation != generation {
                // Stopped or replaced while connecting: drop the tunnel.
                let _ = tx.send(Err(FailureCode::Internal));
                return;
            }
            match result {
                Ok(opened) => {
                    let url = opened.public.origin().to_string();
                    *gate.write().unwrap_or_else(|e| e.into_inner()) = Some(BackendPolicy {
                        proof,
                        origin: opened.public,
                    });
                    if let Some(run) = inner.run.as_mut() {
                        run.tunnel = Some(opened.keep_alive);
                    }
                    inner.status = ConnectionStatus::Ready;
                    inner.url = Some(url.clone());
                    let _ = tx.send(Ok(url));
                }
                Err(failure) => {
                    if let Some(run) = inner.run.take() {
                        run.close();
                    }
                    inner.status = ConnectionStatus::Failed;
                    inner.failure = Some(failure.code);
                    let _ = tx.send(Err(failure.code));
                }
            }
        })
        .abort_handle();
        inner.run = Some(Run {
            backend,
            opener,
            tunnel: None,
        });
        Ok(rx)
    }
}
