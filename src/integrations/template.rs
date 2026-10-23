//! The managed Hook groups of an agent's embedded template.

use serde_json::Value;

use super::assets::{EmbeddedBundle, canonical_json, hook_managed_entries, sha256_hex};
use super::registry::ManagedHookEntry;
use super::types::{Agent, IntegrationError};

/// One managed Hook group of the bundle's template, with its registry entry.
#[derive(Debug, Clone)]
pub struct TemplateGroup {
    pub entry: ManagedHookEntry,
    pub group: Value,
}

/// The managed groups of `agent`'s embedded template.
pub fn template_groups(
    bundle: &EmbeddedBundle,
    agent: Agent,
) -> Result<Vec<TemplateGroup>, IntegrationError> {
    let entries = hook_managed_entries(bundle, agent)?;
    let bad =
        |reason: &str| IntegrationError::Bundle(format!("{} hook template: {reason}", agent.key()));
    let template = bundle
        .entry(&format!("hooks/{}.json", agent.key()))
        .ok_or_else(|| bad("missing"))?;
    let json: Value = serde_json::from_slice(template.bytes).map_err(|_| bad("not JSON"))?;
    entries
        .into_iter()
        .map(|entry| {
            let group = json["hooks"][&entry.event]
                .as_array()
                .and_then(|groups| {
                    groups
                        .iter()
                        .find(|g| sha256_hex(canonical_json(g).as_bytes()) == entry.sha256)
                })
                .cloned()
                .ok_or_else(|| bad("group not found"))?;
            Ok(TemplateGroup { entry, group })
        })
        .collect()
}
