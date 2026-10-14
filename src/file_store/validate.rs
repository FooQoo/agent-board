//! Checks that decide whether shared-file content is accepted.
//!
//! The JSON checks return every defect of a file. The TASK.md and PLAN.md checks
//! look only at the frontmatter's acceptance conditions, and never rewrite the text. Errors name the file and item; reasons are in English.

use std::collections::HashSet;
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use super::frontmatter;
use super::layout::FORMAT_NAME;
use super::model::{
    Choice, EpicFile, HistoryKind, HistoryRecord, ProjectFile, TaskFile, WorkspaceFile,
    current_request,
};
use crate::domain::{
    MAX_ANSWER_TEXT_CHARS, MAX_CHOICE_ID_CHARS, MAX_CHOICE_LABEL_CHARS, MAX_CHOICES,
    MAX_QUESTION_CHARS, RunState, check_work_state, validate_project_name, validate_title,
};

/// An EPIC-ID in canonical form: `[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*`, 1 to 64
/// characters. `FromStr` accepts only the canonical form; `normalize` folds
/// lowercase letters to uppercase first, as the CLI does.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct EpicId(String);

impl EpicId {
    /// Fold ASCII lowercase letters to uppercase, then check the grammar.
    pub fn normalize(text: &str) -> Result<EpicId, AgboardError> {
        text.to_ascii_uppercase().parse()
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn is_epic_id(text: &str) -> bool {
    if text.is_empty() || text.len() > 64 {
        return false;
    }
    let upper_or_digit = |s: &str| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
    };
    let mut parts = text.split('-');
    let first = parts.next().unwrap_or("");
    first
        .as_bytes()
        .first()
        .is_some_and(|b| b.is_ascii_uppercase())
        && upper_or_digit(first)
        && parts.all(upper_or_digit)
}

impl FromStr for EpicId {
    type Err = AgboardError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if is_epic_id(s) {
            Ok(EpicId(s.to_string()))
        } else {
            Err(AgboardError::InvalidValue {
                field: "epicId".into(),
                reason: "EPIC-IDs are 1 to 64 uppercase letters, digits, and hyphens, starting with a letter."
                    .into(),
            })
        }
    }
}

impl fmt::Display for EpicId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for EpicId {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for EpicId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        text.parse()
            .map_err(|e: AgboardError| serde::de::Error::custom(e.reason()))
    }
}

/// `#RRGGBB` with uppercase digits, the stored form of an epic color.
/// Surrounding whitespace is ignored and lowercase digits are folded.
pub fn normalize_color(text: &str) -> Result<String, AgboardError> {
    let trimmed = text.trim();
    match trimmed.strip_prefix('#') {
        Some(hex) if hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()) => {
            Ok(format!("#{}", hex.to_ascii_uppercase()))
        }
        _ => Err(AgboardError::InvalidValue {
            field: "color".into(),
            reason: "Colors are #RRGGBB: a # and six hexadecimal digits.".into(),
        }),
    }
}

fn is_stored_color(text: &str) -> bool {
    normalize_color(text).ok().as_deref() == Some(text)
}

/// An epic's formal name: trimmed, 1 to 100 characters, one line.
pub fn validate_epic_name(text: &str) -> Result<String, AgboardError> {
    let trimmed = text.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > 100 || trimmed.contains(['\n', '\r']) {
        return Err(AgboardError::InvalidValue {
            field: "name".into(),
            reason: "Epic names must be 1 to 100 characters on one line.".into(),
        });
    }
    Ok(trimmed.to_string())
}

/// A plan text with CRLF folded to LF, and at most 50,000 characters of
/// Markdown body. The frontmatter is not counted, because the editor counts only
/// the body.
pub fn normalize_plan(text: &str) -> Result<String, AgboardError> {
    let normalized = text.replace("\r\n", "\n");
    let body = super::frontmatter::parse(&normalized).body;
    let count = body.chars().count();
    if count > 50_000 {
        return Err(AgboardError::InvalidValue {
            field: "plan".into(),
            reason: "Plans must be 50,000 characters or fewer.".into(),
        });
    }
    Ok(normalized)
}

/// Check that an attachment or evidence ID has the stored form (32 lowercase
/// hexadecimal characters). This is the check before a path is built from it.
pub fn check_object_id(text: &str, field: &str) -> Result<(), AgboardError> {
    if is_hex32(text) {
        Ok(())
    } else {
        Err(AgboardError::InvalidValue {
            field: field.into(),
            reason: "IDs are 32 lowercase hexadecimal characters.".into(),
        })
    }
}
use crate::error::AgboardError;

/// One defect found by a check. `field` names the item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Defect {
    pub field: String,
    pub reason: String,
}

fn defect(field: &str, reason: &str) -> Defect {
    Defect {
        field: field.to_string(),
        reason: reason.to_string(),
    }
}

/// The TASK.md written when a card is created without a body.
pub fn task_template() -> String {
    "---\nacceptance: []\n---\n\n".to_string()
}

/// True for a 32-character lowercase hexadecimal string (history and request IDs).
pub fn is_hex32(text: &str) -> bool {
    text.len() == 32 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The PLAN.md written when an epic is created without a plan.
pub fn plan_template() -> String {
    "---\nacceptance: []\n---\n\n".to_string()
}

/// Check a TASK.md text: its frontmatter. The body is not checked.
pub fn check_task_body(text: &str) -> Vec<Defect> {
    frontmatter::parse(text).defects
}

/// Check a PLAN.md text: its frontmatter, as for TASK.md.
pub fn check_plan_body(text: &str) -> Vec<Defect> {
    frontmatter::parse(text).defects
}

/// Turn the first defect of a TASK.md text into a `file_invalid` error.
/// `file` is the path shown to the caller (relative to the shared directory).
pub fn ensure_task_body(text: &str, file: &str) -> Result<(), AgboardError> {
    first_defect_error(check_task_body(text), file)
}

/// The PLAN.md form of `ensure_task_body`.
pub fn ensure_plan_body(text: &str, file: &str) -> Result<(), AgboardError> {
    first_defect_error(check_plan_body(text), file)
}

fn first_defect_error(defects: Vec<Defect>, file: &str) -> Result<(), AgboardError> {
    match defects.into_iter().next() {
        None => Ok(()),
        Some(d) => Err(AgboardError::FileInvalid {
            file: file.to_string(),
            field: d.field,
            reason: d.reason,
        }),
    }
}

/// Defects of `epic.json`. `folder_id` is the name of the epic folder.
pub fn check_epic(file: &EpicFile, folder_id: &str) -> Vec<Defect> {
    let mut out = Vec::new();
    if file.id.as_str() != folder_id {
        out.push(defect("id", "The ID does not match the folder name."));
    }
    if validate_epic_name(&file.name).ok().as_deref() != Some(file.name.as_str()) {
        out.push(defect(
            "name",
            "Epic names must be 1 to 100 characters on one line.",
        ));
    }
    if !is_stored_color(&file.color) {
        out.push(defect(
            "color",
            "Colors are stored as #RRGGBB in uppercase.",
        ));
    }
    for (i, attachment) in file.attachments.iter().enumerate() {
        if !is_hex32(&attachment.id) {
            out.push(defect(
                &format!("attachments[{i}].id"),
                "Attachment IDs are 32 lowercase hexadecimal characters.",
            ));
        }
    }
    out
}

/// The first defect of a decision request's choices, if any. Field names are
/// relative: `choices`, `choices.id`, or `choices.label`.
pub fn choice_defect(choices: &[Choice]) -> Option<Defect> {
    if choices.len() > MAX_CHOICES {
        return Some(defect("choices", "A request can have at most 10 choices."));
    }
    let mut ids = HashSet::new();
    for choice in choices {
        let id_ok = (1..=MAX_CHOICE_ID_CHARS).contains(&choice.id.len())
            && choice
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        if !id_ok {
            return Some(defect(
                "choices.id",
                "Choice IDs are 1 to 64 ASCII letters, digits, hyphens, or underscores.",
            ));
        }
        if !ids.insert(choice.id.as_str()) {
            return Some(defect(
                "choices.id",
                "Choice IDs must be unique within a request.",
            ));
        }
        let label_chars = choice.label.trim().chars().count();
        if !(1..=MAX_CHOICE_LABEL_CHARS).contains(&label_chars) {
            return Some(defect(
                "choices.label",
                "Choice labels must be 1 to 200 characters.",
            ));
        }
    }
    None
}

/// Trim the labels of `choices` and check them. A violation is `InvalidValue`.
pub fn normalize_choices(choices: Vec<Choice>) -> Result<Vec<Choice>, AgboardError> {
    let normalized: Vec<Choice> = choices
        .into_iter()
        .map(|c| Choice {
            id: c.id,
            label: c.label.trim().to_string(),
        })
        .collect();
    match choice_defect(&normalized) {
        None => Ok(normalized),
        Some(d) => Err(AgboardError::InvalidValue {
            field: d.field,
            reason: d.reason,
        }),
    }
}

/// Normalize line endings (CRLF to LF), trim the outer whitespace, and require
/// 1 to 2,000 characters. This is the rule of a decision request's question.
pub fn normalize_question(text: &str) -> Result<String, AgboardError> {
    let normalized = text.replace("\r\n", "\n");
    let trimmed = normalized.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > MAX_QUESTION_CHARS {
        return Err(AgboardError::InvalidValue {
            field: "question".into(),
            reason: "Questions must be 1 to 2000 characters.".into(),
        });
    }
    Ok(trimmed.to_string())
}

/// Normalize a free-text answer. Blank text counts as no text (`None`). Text
/// over 2,000 characters is `InvalidValue`.
pub fn normalize_answer_text(text: &str) -> Result<Option<String>, AgboardError> {
    let normalized = text.replace("\r\n", "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > MAX_ANSWER_TEXT_CHARS {
        return Err(AgboardError::InvalidValue {
            field: "text".into(),
            reason: "Answers must be 2,000 characters or fewer.".into(),
        });
    }
    Ok(Some(trimmed.to_string()))
}

/// Accept the requested format version. A missing version is `file_invalid`;
/// any other version is `format_unsupported`. Nothing is converted.
pub fn check_format_version(value: &Value, file: &str) -> Result<(), AgboardError> {
    check_format_version_expected(value, file, 1)
}

pub fn check_format_version_expected(
    value: &Value,
    file: &str,
    expected: u32,
) -> Result<(), AgboardError> {
    match value.get("formatVersion") {
        None => Err(AgboardError::FileInvalid {
            file: file.to_string(),
            field: "formatVersion".into(),
            reason: "formatVersion is required.".into(),
        }),
        Some(version) if version.as_u64() == Some(u64::from(expected)) => Ok(()),
        Some(version) => Err(AgboardError::FormatUnsupported {
            file: file.to_string(),
            version: version.to_string(),
            expected,
        }),
    }
}

pub fn check_workspace(file: &WorkspaceFile) -> Vec<Defect> {
    if file.format == FORMAT_NAME {
        Vec::new()
    } else {
        vec![defect("format", "The format must be agboard-files.")]
    }
}

/// Defects of `project.json`. `folder_id` is the name of the project folder.
pub fn check_project(file: &ProjectFile, folder_id: &str) -> Vec<Defect> {
    let mut out = Vec::new();
    if file.id.as_str() != folder_id {
        out.push(defect("id", "The ID does not match the folder name."));
    }
    if validate_project_name(&file.name).ok().as_deref() != Some(file.name.as_str()) {
        out.push(defect(
            "name",
            "Project names must be 1 to 50 characters on one line.",
        ));
    }
    if file.next_card_id < 1 {
        out.push(defect("nextCardId", "The next card ID starts at 1."));
    }
    out
}

/// Defects of `task.json`. `folder_id` is the card ID of the folder.
pub fn check_task(task: &TaskFile, folder_id: i64) -> Vec<Defect> {
    let mut out = check_task_metadata(task, folder_id);
    if task.agent_status == RunState::Pending
        && task.pending_request_id.as_deref().is_some_and(is_hex32)
        && current_request(task).is_none()
    {
        out.push(defect(
            "pendingRequestId",
            "No history event holds the pending request.",
        ));
    }
    out.extend(check_history(&task.history));
    out
}

/// Defects of the task metadata independent of TASK.md history validity.
pub fn check_task_metadata(task: &TaskFile, folder_id: i64) -> Vec<Defect> {
    let mut out = Vec::new();
    if task.id != folder_id {
        out.push(defect("id", "The ID does not match the folder name."));
    }
    if validate_title(&task.title).ok().as_deref() != Some(task.title.as_str()) {
        out.push(defect(
            "title",
            "Titles must be 1 to 100 characters on one line.",
        ));
    }
    if task.position < 1 {
        out.push(defect("position", "Positions start at 1."));
    }
    if check_work_state(task.assignee, task.card_status, task.agent_status).is_err() {
        out.push(defect(
            "agentStatus",
            "Running and pending need an AI-owned card in Doing.",
        ));
    }
    if task.is_draft && !matches!(task.agent_status, RunState::Idle | RunState::Pending) {
        out.push(defect(
            "isDraft",
            "Only idle or pending cards can be drafts.",
        ));
    }
    match (task.agent_status, task.pending_request_id.as_deref()) {
        (RunState::Pending, None) => out.push(defect(
            "pendingRequestId",
            "A pending card needs a request ID.",
        )),
        (RunState::Pending, Some(id)) => {
            if !is_hex32(id) {
                out.push(defect(
                    "pendingRequestId",
                    "Request IDs are 32 lowercase hexadecimal characters.",
                ));
            }
        }
        (_, Some(_)) => out.push(defect(
            "pendingRequestId",
            "Only a pending card has a request ID.",
        )),
        (_, None) => {}
    }
    if task.archived_at.is_some()
        && (task.agent_status != RunState::Idle || task.pending_request_id.is_some())
    {
        out.push(defect(
            "archivedAt",
            "An archived card is idle and has no request.",
        ));
    }
    out
}

pub fn check_history(events: &[HistoryRecord]) -> Vec<Defect> {
    let mut out = Vec::new();
    if !events.iter().any(|e| e.kind == HistoryKind::Created) {
        out.push(defect(
            "history",
            "The history must contain a created event.",
        ));
    }

    let mut ids = HashSet::new();
    for (i, event) in events.iter().enumerate() {
        let field = |name: &str| format!("history[{i}].{name}");
        if !is_hex32(&event.id) {
            out.push(Defect {
                field: field("id"),
                reason: "History IDs are 32 lowercase hexadecimal characters.".into(),
            });
        } else if !ids.insert(event.id.as_str()) {
            out.push(Defect {
                field: field("id"),
                reason: "History IDs must be unique.".into(),
            });
        }
        if let Some(request) = event.request_id.as_deref()
            && !is_hex32(request)
        {
            out.push(Defect {
                field: field("requestId"),
                reason: "Request IDs are 32 lowercase hexadecimal characters.".into(),
            });
        }
        let has_reason = event
            .reason
            .as_deref()
            .is_some_and(|r| !r.trim().is_empty());
        match event.kind {
            HistoryKind::Lane
            | HistoryKind::Agent
            | HistoryKind::Archive
            | HistoryKind::Restore => {
                if !has_reason {
                    out.push(Defect {
                        field: field("reason"),
                        reason: "A state change needs a reason.".into(),
                    });
                }
            }
            HistoryKind::Answer => {
                if event.request_id.is_none() {
                    out.push(Defect {
                        field: field("requestId"),
                        reason: "An answer names the request it answers.".into(),
                    });
                }
                if event.choice_id.is_some() && event.choice_label.is_none() {
                    out.push(Defect {
                        field: field("choiceLabel"),
                        reason: "An answer with a choice needs its label.".into(),
                    });
                }
                if event.choice_id.is_none() && !has_reason {
                    out.push(Defect {
                        field: field("reason"),
                        reason: "An answer needs a choice, text, or both.".into(),
                    });
                }
            }
            HistoryKind::Draft => {
                if event.is_draft.is_none() {
                    out.push(Defect {
                        field: field("isDraft"),
                        reason: "A draft event records the new draft flag.".into(),
                    });
                }
            }
            HistoryKind::Created | HistoryKind::Epic => {}
        }
        if event.kind == HistoryKind::Agent && event.to_agent_status == RunState::Pending {
            if event
                .question
                .as_deref()
                .is_none_or(|q| q.trim().is_empty())
            {
                out.push(Defect {
                    field: field("question"),
                    reason: "A pending request needs a question.".into(),
                });
            }
            match &event.choices {
                None => out.push(Defect {
                    field: field("choices"),
                    reason: "A pending request needs its choices (may be empty).".into(),
                }),
                Some(choices) => {
                    if let Some(d) = choice_defect(choices) {
                        out.push(Defect {
                            field: format!("history[{i}].{}", d.field),
                            reason: d.reason,
                        });
                    }
                }
            }
        }
    }
    out
}
