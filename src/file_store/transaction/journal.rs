//! The journal file: its phases, content hashes and serialization.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{PairBytes, PairTargets};
use crate::error::AgboardError;
use crate::file_store::io::write_error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum Phase {
    Prepared,
    Committed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Journal {
    pub(super) format_version: u32,
    pub(super) phase: Phase,
    pub(super) targets: PairTargets,
    pub(super) old: PairBytes,
    pub(super) new: PairBytes,
    pub(super) old_hashes: PairHashes,
    pub(super) new_hashes: PairHashes,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct PairHashes {
    pub(super) metadata: String,
    pub(super) markdown: String,
}

pub(super) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(super) fn hashes(bytes: &PairBytes) -> PairHashes {
    PairHashes {
        metadata: hash(&bytes.metadata),
        markdown: hash(&bytes.markdown),
    }
}

pub(super) fn serialize(journal: &Journal) -> Result<Vec<u8>, AgboardError> {
    serde_json::to_vec(journal).map_err(|e| write_error(".internal/transactions", e))
}
