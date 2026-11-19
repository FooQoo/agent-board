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
    /// is not 32 lowercase hex digits or the task (up to 2^53 - 1) or version is not a positive number.
    pub fn result_link(&self, project_id: &str, task_id: i64, version: u32) -> Option<String> {
        if version < 1 {
            return None;
        }
        Some(format!(
            "{}&result={version}",
            self.task_link(project_id, task_id)?
        ))
    }

    /// The address that opens one project on the phone: `https://host[:port]/?project=<id>`.
    /// `None` when the project is not 32 lowercase hex digits.
    pub fn project_link(&self, project_id: &str) -> Option<String> {
        let valid = project_id.len() == 32
            && project_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        valid.then(|| format!("{}/?project={project_id}", self.origin))
    }

    /// The address that opens one task on the phone: `https://host[:port]/?project=<id>&task=<n>`.
    /// The task's detail shows its open questions and its history. `None` under the same limits as
    /// [`PublicOrigin::result_link`].
    pub fn task_link(&self, project_id: &str, task_id: i64) -> Option<String> {
        let valid_project = project_id.len() == 32
            && project_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !valid_project || !(1..=9_007_199_254_740_991).contains(&task_id) {
            return None;
        }
        Some(format!(
            "{}/?project={project_id}&task={task_id}",
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
