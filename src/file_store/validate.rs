//! Checks that decide whether shared-file content is accepted.
//!
//! The JSON checks return every defect of a file. The TASK.md check looks only
//! at the required headings and the shape of completion conditions, and never
//! rewrites the text. Errors name the file and item; reasons are in English.

use std::collections::HashSet;
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

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

/// A plan text with CRLF folded to LF, at most 50,000 characters. The
/// required headings are checked separately by `check_plan_body`.
pub fn normalize_plan(text: &str) -> Result<String, AgboardError> {
    let normalized = text.replace("\r\n", "\n");
    let count = normalized.chars().count();
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

/// A required heading or label: its English name, which new files use, and
/// the Japanese name that earlier files use. Either is accepted.
type Name = (&'static str, &'static str);

/// Headings every TASK.md must contain, in template order.
const REQUIRED_HEADINGS: [Name; 3] = [
    ("Work", "作業内容"),
    ("Completion conditions", "完了条件と確認結果"),
    ("Execution log", "実行記録"),
];
const CONDITION_SECTION: Name = ("Completion conditions", "完了条件と確認結果");
/// Lines every completion condition must carry, in the order of the template.
const CONDITION_LINES: [Name; 3] = [
    ("Result:", "確認結果:"),
    ("Evidence:", "根拠:"),
    ("Coordinator check:", "調整役の確認:"),
];

fn is_name(text: &str, name: Name) -> bool {
    text == name.0 || text == name.1
}

/// The TASK.md written when a card is created without a body.
pub fn task_template() -> String {
    "## Work\n\n(Describe the purpose of the work and what to do.)\n\n## Completion conditions\n\n- [ ] AC-1. (Describe a condition that can be verified.)\n  - Result: Not verified\n  - Evidence: Not recorded\n  - Coordinator check: Not checked\n\n## Execution log\n\n".to_string()
}

/// True for a 32-character lowercase hexadecimal string (history and request IDs).
pub fn is_hex32(text: &str) -> bool {
    text.len() == 32 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The heading name of a Markdown ATX heading (`## name`), if `line` is one.
fn heading_name(line: &str) -> Option<String> {
    let hashes = line.bytes().take_while(|b| *b == b'#').count();
    if !(1..=6).contains(&hashes) {
        return None;
    }
    let rest = line[hashes..].strip_prefix(' ')?;
    let name = rest.trim_end();
    (!name.is_empty()).then(|| name.to_string())
}

/// The fence marker (`` ``` `` or `~~~`) that opens or closes a code block.
fn fence_marker(trimmed: &str) -> Option<&'static str> {
    if trimmed.starts_with("```") {
        Some("```")
    } else if trimmed.starts_with("~~~") {
        Some("~~~")
    } else {
        None
    }
}

/// The ID of a completion condition line `- [ ] AC-n. body`. Any checkbox
/// state is accepted. Returns `None` when the line does not have that form.
fn condition_id(line: &str) -> Option<String> {
    let rest = line
        .strip_prefix("- [ ] ")
        .or_else(|| line.strip_prefix("- [x] "))
        .or_else(|| line.strip_prefix("- [X] "))?;
    let after = rest.strip_prefix("AC-")?;
    let digits = after.bytes().take_while(|b| b.is_ascii_digit()).count();
    if digits == 0 {
        return None;
    }
    let (number, tail) = after.split_at(digits);
    let body = tail.strip_prefix(". ")?;
    if body.trim().is_empty() {
        return None;
    }
    Some(format!("AC-{number}"))
}

/// The label of a detail line (`  - Evidence: ...`) under a condition, if it has one.
fn condition_label(line: &str) -> Option<Name> {
    let rest = line.trim_start().strip_prefix("- ")?;
    CONDITION_LINES
        .iter()
        .copied()
        .find(|label| rest.starts_with(label.0) || rest.starts_with(label.1))
}

/// Headings every PLAN.md must contain, in template order.
const PLAN_HEADINGS: [Name; 4] = [
    ("Goal", "目的"),
    ("Scope", "対象範囲"),
    ("Completion conditions", "完了条件と確認結果"),
    ("Approach", "進め方"),
];

/// The PLAN.md written when an epic is created without a plan.
pub fn plan_template() -> String {
    "## Goal\n\n(Describe the purpose of the epic.)\n\n## Scope\n\n(Describe what is in and out of scope.)\n\n## Completion conditions\n\n- [ ] AC-1. (Describe a condition that can be verified.)\n  - Result: Not verified\n  - Evidence: Not recorded\n  - Coordinator check: Not checked\n\n## Approach\n\n(Describe how the work proceeds.)\n".to_string()
}

/// Check a TASK.md text: the required headings and the completion conditions.
/// Headings and conditions inside fenced code blocks do not count. Returns
/// every defect; an empty list means the text is accepted.
pub fn check_task_body(text: &str) -> Vec<Defect> {
    check_markdown(text, &REQUIRED_HEADINGS)
}

/// Check a PLAN.md text: the four required headings and the completion
/// conditions, under the same rules as TASK.md.
pub fn check_plan_body(text: &str) -> Vec<Defect> {
    check_markdown(text, &PLAN_HEADINGS)
}

fn check_markdown(text: &str, required: &[Name]) -> Vec<Defect> {
    let lines: Vec<&str> = text
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();

    let mut fence: Option<&str> = None;
    let mut outside = vec![false; lines.len()];
    let mut headings: Vec<(usize, String)> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if let Some(marker) = fence_marker(trimmed) {
            match fence {
                None => fence = Some(marker),
                Some(open) if open == marker => fence = None,
                Some(_) => {}
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        outside[i] = true;
        if let Some(name) = heading_name(line) {
            headings.push((i, name));
        }
    }

    let mut out = Vec::new();
    for &name in required {
        if !headings.iter().any(|(_, heading)| is_name(heading, name)) {
            out.push(defect(
                &format!("## {}", name.0),
                "The required heading is missing.",
            ));
        }
    }

    let Some(position) = headings
        .iter()
        .position(|(_, heading)| is_name(heading, CONDITION_SECTION))
    else {
        return out;
    };
    let section_field = format!("## {}", headings[position].1);
    let start = headings[position].0 + 1;
    let end = headings
        .get(position + 1)
        .map_or(lines.len(), |(index, _)| *index);

    // Each condition with the detail labels found below it.
    let mut blocks: Vec<(String, Vec<Name>)> = Vec::new();
    let mut current: Option<usize> = None;
    for i in start..end {
        if !outside[i] {
            continue;
        }
        let line = lines[i];
        if line.starts_with("- [") {
            match condition_id(line) {
                Some(id) => {
                    blocks.push((id, Vec::new()));
                    current = Some(blocks.len() - 1);
                }
                None => {
                    out.push(defect(
                        &section_field,
                        "A completion condition must start with \"- [ ] AC-n. \" followed by its text.",
                    ));
                    current = None;
                }
            }
            continue;
        }
        if let (Some(index), Some(label)) = (current, condition_label(line)) {
            blocks[index].1.push(label);
        }
    }
    for (id, found) in blocks {
        for label in CONDITION_LINES {
            if !found.contains(&label) {
                out.push(defect(
                    &id,
                    &format!(
                        "A line starting with \"- {}\" (or \"- {}\") is missing below the condition.",
                        label.0, label.1
                    ),
                ));
            }
        }
    }
    out
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

/// Accept only `formatVersion: 1`. A missing version is `file_invalid`; any
/// other version is `format_unsupported`. Nothing is converted.
pub fn check_format_version(value: &Value, file: &str) -> Result<(), AgboardError> {
    match value.get("formatVersion") {
        None => Err(AgboardError::FileInvalid {
            file: file.to_string(),
            field: "formatVersion".into(),
            reason: "formatVersion is required.".into(),
        }),
        Some(version) if version.as_u64() == Some(1) => Ok(()),
        Some(version) => Err(AgboardError::FormatUnsupported {
            file: file.to_string(),
            version: version.to_string(),
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
            } else if current_request(task).is_none() {
                out.push(defect(
                    "pendingRequestId",
                    "No history event holds the pending request.",
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
    if !task.history.iter().any(|e| e.kind == HistoryKind::Created) {
        out.push(defect(
            "history",
            "The history must contain a created event.",
        ));
    }
    out.extend(check_history(&task.history));
    out
}

fn check_history(events: &[HistoryRecord]) -> Vec<Defect> {
    let mut out = Vec::new();
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
