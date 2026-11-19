//! The public Origin/Host checks.

use axum::http::HeaderMap;
use url::Url;

use super::ContractError;

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

    /// The address that opens one result of a task on the phone:
    /// `https://host[:port]/?project=<id>&task=<n>&result=<version>`. The path is `/` and the target
    /// is in the query, so the page shell and the passcode screen keep it. `None` when the project
    /// is not 32 lowercase hex digits or the task or version is not a positive number.
    pub fn result_link(&self, project_id: &str, task_id: i64, version: u32) -> Option<String> {
        let valid_project = project_id.len() == 32
            && project_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !valid_project || task_id < 1 || version < 1 {
            return None;
        }
        Some(format!(
            "{}/?project={project_id}&task={task_id}&result={version}",
            self.origin
        ))
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
