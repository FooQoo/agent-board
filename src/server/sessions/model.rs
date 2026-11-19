//! The values of the session registry: tool, origin, state, the listed view, and the headers.

use axum::http::HeaderMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::domain::ProjectId;

/// The stable key of the session that sends the stream request.
pub const SESSION_HEADER: &str = "x-agboard-session";
/// `claude-code`, `codex` or `unknown`.
pub const SESSION_TOOL_HEADER: &str = "x-agboard-session-tool";
/// `board` or `external`.
pub const SESSION_ORIGIN_HEADER: &str = "x-agboard-session-origin";
/// The ID of the project the session waits on.
pub const SESSION_PROJECT_HEADER: &str = "x-agboard-session-project";

/// How long a session whose stream closed stays in the count.
pub const GRACE: Duration = Duration::from_secs(30);

const MAX_KEY_LEN: usize = 64;

/// The agent tool a session runs in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tool {
    ClaudeCode,
    Codex,
    Unknown,
}

impl Tool {
    pub fn as_str(self) -> &'static str {
        match self {
            Tool::ClaudeCode => "claude-code",
            Tool::Codex => "codex",
            Tool::Unknown => "unknown",
        }
    }

    /// A tool name from a header; anything else is `Unknown`.
    pub fn parse(text: &str) -> Tool {
        match text {
            "claude-code" => Tool::ClaudeCode,
            "codex" => Tool::Codex,
            _ => Tool::Unknown,
        }
    }
}

/// Who started the session: the board's launcher, or a person in their own terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Origin {
    Board,
    External,
}

impl Origin {
    pub fn as_str(self) -> &'static str {
        match self {
            Origin::Board => "board",
            Origin::External => "external",
        }
    }

    /// An origin from a header; anything but `board` is `External`.
    pub fn parse(text: &str) -> Origin {
        if text == "board" {
            Origin::Board
        } else {
            Origin::External
        }
    }
}

/// Whether the stream of the session is open now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    Connected,
    /// The stream closed; the session still counts until the grace period ends.
    Grace,
}

/// One session as the API lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: String,
    pub tool: Tool,
    pub origin: Origin,
    #[serde(with = "crate::clock::serde_utc")]
    pub connected_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub last_seen_at: DateTime<Utc>,
    pub state: State,
}

/// The sessions of one project and their counts. `total` includes the sessions in grace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionList {
    pub sessions: Vec<SessionView>,
    pub counts: Counts,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub total: usize,
    pub connected: usize,
    pub by_tool: ToolCounts,
    pub by_origin: OriginCounts,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct ToolCounts {
    #[serde(rename = "claude-code")]
    pub claude_code: usize,
    pub codex: usize,
    pub unknown: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct OriginCounts {
    pub board: usize,
    pub external: usize,
}

/// A board launch is refused because a board-launched session, of `tool`, already counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LaunchRefused {
    pub tool: Tool,
}

/// What a stream request says about its session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attributes {
    pub project: ProjectId,
    pub key: String,
    pub tool: Tool,
    pub origin: Origin,
}

impl Attributes {
    /// The session a stream request names, or `None` when it names none or names it badly. A bad
    /// name never fails the stream: it is just not counted.
    pub fn from_headers(headers: &HeaderMap) -> Option<Attributes> {
        let text = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
        let key = text(SESSION_HEADER)?;
        if !valid_key(key) {
            return None;
        }
        Some(Attributes {
            project: text(SESSION_PROJECT_HEADER)?.parse().ok()?,
            key: key.to_string(),
            tool: Tool::parse(text(SESSION_TOOL_HEADER).unwrap_or_default()),
            origin: Origin::parse(text(SESSION_ORIGIN_HEADER).unwrap_or_default()),
        })
    }
}

/// A session key is 1 to 64 characters of `A-Z a-z 0-9 . _ : -`.
pub fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-'))
}
