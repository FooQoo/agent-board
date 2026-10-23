//! Agent integrations: the Skill and Hook files embedded in the binary, the
//! placement of each agent's Skill and Hook for the chosen scopes, and the
//! installation registry that records what was installed.
//!
//! - [`assets`]: the embedded bundle and its hashes.
//! - [`paths`]: the pure placement functions.
//! - [`registry`]: the `integrations.json` schema.
//! - [`types`]: the shared enums, resolved targets, and errors.

pub mod assets;
pub mod paths;
pub mod registry;
pub mod types;

pub use types::{Agent, Component, EffectivePaths, IntegrationError, ResolvedTargets, Scope};
