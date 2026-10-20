//! The Edge Traffic Policy generator.

use std::fmt;

use serde_json::{Value, json};

use super::{ContractError, PROOF_HEADER, TunnelProof, normalize_emails};

/// Google OAuth app used by the policy. The secret is redacted from `Debug`.
#[derive(Clone, PartialEq, Eq)]
pub enum PolicyOauth {
    Managed,
    Custom {
        client_id: String,
        client_secret: String,
    },
}

impl fmt::Debug for PolicyOauth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Managed => f.write_str("Managed"),
            Self::Custom { .. } => f.write_str("Custom { <redacted> }"),
        }
    }
}

/// Build the Edge Traffic Policy as a JSON document (valid YAML).
///
/// Phases run in this order: Google OAuth, deny anyone whose email is not on the
/// allow list, remove every incoming proof header, add exactly one proof header.
/// The allow list is serialized as a list of JSON strings, never concatenated
/// into the expression by hand. The result contains secrets: do not log it.
pub fn build_traffic_policy(
    allow_emails: &[String],
    proof: &TunnelProof,
    oauth: &PolicyOauth,
) -> Result<String, ContractError> {
    let emails = normalize_emails(allow_emails)?;
    let mut oauth_config = json!({ "provider": "google" });
    if let PolicyOauth::Custom {
        client_id,
        client_secret,
    } = oauth
    {
        if client_id.is_empty() || client_secret.is_empty() {
            return Err(ContractError::MissingOauthCredentials);
        }
        oauth_config["client_id"] = Value::String(client_id.clone());
        oauth_config["client_secret"] = Value::String(client_secret.clone());
    }
    let list = Value::Array(emails.into_iter().map(Value::String).collect());
    let expression = format!("!(actions.ngrok.oauth.identity.email in {list})");
    let policy = json!({
        "on_http_request": [
            { "actions": [ { "type": "oauth", "config": oauth_config } ] },
            {
                "expressions": [ expression ],
                "actions": [ { "type": "deny", "config": { "status_code": 403 } } ]
            },
            {
                "actions": [ {
                    "type": "remove-headers",
                    "config": { "headers": [ PROOF_HEADER ] }
                } ]
            },
            {
                "actions": [ {
                    "type": "add-headers",
                    "config": { "headers": { PROOF_HEADER: proof.expose() } }
                } ]
            }
        ]
    });
    Ok(policy.to_string())
}
