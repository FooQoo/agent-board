//! Agent integrations: the Skill and Hook files embedded in the binary, the
//! placement of each agent's Skill and Hook for the chosen scopes, and the
//! installation registry that records what was installed.
//!
//! - [`assets`]: the embedded bundle and its hashes.
//! - [`paths`]: the pure placement functions.
//! - [`registry`]: the `integrations.json` schema.
//! - [`plan`], [`merge`], [`duplicates`], [`skill`]: planning one agent's
//!   installation without writing.
//! - [`apply`], [`journal`], [`recovery`]: the per-agent transaction and its
//!   recovery.
//! - [`types`]: the shared enums, resolved targets, and errors.

pub mod apply;
pub mod assets;
mod compose;
pub mod duplicates;
pub mod journal;
pub mod merge;
mod ops;
pub mod outcome;
pub mod paths;
pub mod plan;
pub mod recovery;
pub mod registry;
pub mod skill;
pub mod template;
pub mod types;

pub use types::{Agent, Component, EffectivePaths, IntegrationError, ResolvedTargets, Scope};
