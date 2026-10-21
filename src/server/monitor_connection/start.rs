//! Starting the tunnel: the loopback backend and the task that opens the endpoint.

use std::sync::{Arc, RwLock};

use tokio::sync::oneshot;
use url::Url;

use super::backend::{SharedListener, external_app, internal_token, serve};
use super::contracts::{
    ConnectionConfig, ConnectionStatus, ContractError, OauthApp, PolicyOauth, TunnelProof,
    build_traffic_policy,
};
use super::lifecycle::{Inner, MonitorConnections};
use super::router::{BackendPolicy, Gate, backend_router};
use super::run::Run;
use super::types::{FailureCode, OpenRequest, Secret, StartError};
use crate::server::monitor_auth::contracts::SESSION_MAX_AGE_SECS;
use crate::server::monitor_auth::session::{SessionStore, system_clock};

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
        let app = self
            .app
            .get()
            .and_then(std::sync::Weak::upgrade)
            .ok_or(StartError::Internal)?;
        let proof = TunnelProof::generate().map_err(|_| StartError::Internal)?;
        let policy = build_traffic_policy(&config.allow_emails, &proof, &oauth)
            .map_err(StartError::Invalid)?;

        self.teardown(inner);
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
            .and_then(|l| l.set_nonblocking(true).map(|()| l))
            .and_then(tokio::net::TcpListener::from_std)
            .map(|l| SharedListener(Arc::new(l)))
            .map_err(|_| StartError::Internal)?;
        let port = listener
            .0
            .local_addr()
            .map_err(|_| StartError::Internal)?
            .port();
        let backend_url =
            Url::parse(&format!("http://127.0.0.1:{port}")).map_err(|_| StartError::Internal)?;
        let gate: Gate = Arc::new(RwLock::new(None));
        // Until the tunnel is up the backend refuses everything.
        let refuser = serve(&listener, backend_router(gate.clone()));

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
        let run_gate = gate.clone();
        let (tx, rx) = oneshot::channel();
        let this = self.clone();
        let opening = self.connector.open(request);
        let opener =
            tokio::spawn(async move {
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
                        let Ok(token) = internal_token() else {
                            if let Some(run) = inner.run.take() {
                                run.close();
                            }
                            inner.status = ConnectionStatus::Failed;
                            inner.failure = Some(FailureCode::Internal);
                            let _ = tx.send(Err(FailureCode::Internal));
                            return;
                        };
                        let sessions =
                            Arc::new(SessionStore::new(system_clock(), SESSION_MAX_AGE_SECS));
                        let app = external_app(&app, &opened.public, token.clone(), gate.clone());
                        if let Some(run) = inner.run.as_mut() {
                            // The refusing router hands the socket to the real one.
                            run.backend.abort();
                            run.backend = serve(&listener, app);
                            run.tunnel = Some(opened.keep_alive);
                        }
                        *gate.write().unwrap_or_else(|e| e.into_inner()) = Some(
                            BackendPolicy::new(proof, opened.public, generation, sessions, token),
                        );
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
            gate: run_gate,
            backend: refuser,
            opener,
            tunnel: None,
        });
        Ok(rx)
    }
}
