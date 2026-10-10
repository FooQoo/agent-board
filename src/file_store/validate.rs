//! Checks that decide whether shared-file content is accepted.
//!
//! The JSON checks return every defect of a file. The TASK.md check looks only
//! at the required headings and the shape of completion conditions, and never
//! rewrites the text. Errors name the file and item; reasons are in English.

use std::collections::HashSet;

use serde_json::Value;

use super::layout::FORMAT_NAME;
use super::model::{
    Choice, HistoryKind, HistoryRecord, ProjectFile, TaskFile, WorkspaceFile, current_request,
};
use crate::domain::{RunState, check_work_state, validate_project_name, validate_title};
use crate::error::SkanError;

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

/// Headings every TASK.md must contain, in template order.
const REQUIRED_HEADINGS: [&str; 3] = ["作業内容", "完了条件と確認結果", "実行記録"];
const CONDITION_SECTION: &str = "完了条件と確認結果";
/// Lines every completion condition must carry, in the order of the template.
const CONDITION_LINES: [&str; 3] = ["確認結果:", "根拠:", "調整役の確認:"];

/// The TASK.md written when a card is created without a body.
pub fn task_template() -> String {
    "## 作業内容\n\n（作業の目的と内容を書く）\n\n## 完了条件と確認結果\n\n- [ ] AC-1. （完了条件を書く）\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n".to_string()
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

/// The label of a detail line (`  - 根拠: ...`) under a condition, if it has one.
fn condition_label(line: &str) -> Option<&'static str> {
    let rest = line.trim_start().strip_prefix("- ")?;
    CONDITION_LINES
        .iter()
        .copied()
        .find(|label| rest.starts_with(label))
}

/// Check a TASK.md text: the required headings and the completion conditions.
/// Headings and conditions inside fenced code blocks do not count. Returns
/// every defect; an empty list means the text is accepted.
pub fn check_task_body(text: &str) -> Vec<Defect> {
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
    for name in REQUIRED_HEADINGS {
        if !headings.iter().any(|(_, heading)| heading == name) {
            out.push(defect(
                &format!("## {name}"),
                "The required heading is missing.",
            ));
        }
    }

    let Some(position) = headings
        .iter()
        .position(|(_, heading)| heading == CONDITION_SECTION)
    else {
        return out;
    };
    let section_field = format!("## {CONDITION_SECTION}");
    let start = headings[position].0 + 1;
    let end = headings
        .get(position + 1)
        .map_or(lines.len(), |(index, _)| *index);

    // Each condition with the detail labels found below it.
    let mut blocks: Vec<(String, Vec<&'static str>)> = Vec::new();
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
                    &format!("A line starting with \"- {label}\" is missing below the condition."),
                ));
            }
        }
    }
    out
}

/// Turn the first defect of a TASK.md text into a `file_invalid` error.
/// `file` is the path shown to the caller (relative to the shared directory).
pub fn ensure_task_body(text: &str, file: &str) -> Result<(), SkanError> {
    match check_task_body(text).into_iter().next() {
        None => Ok(()),
        Some(d) => Err(SkanError::FileInvalid {
            file: file.to_string(),
            field: d.field,
            reason: d.reason,
        }),
    }
}

/// The first defect of a decision request's choices, if any. Field names are
/// relative: `choices`, `choices.id`, or `choices.label`.
pub fn choice_defect(choices: &[Choice]) -> Option<Defect> {
    if choices.len() > 10 {
        return Some(defect("choices", "A request can have at most 10 choices."));
    }
    let mut ids = HashSet::new();
    for choice in choices {
        let id_ok = (1..=64).contains(&choice.id.len())
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
        if !(1..=200).contains(&label_chars) {
            return Some(defect(
                "choices.label",
                "Choice labels must be 1 to 200 characters.",
            ));
        }
    }
    None
}

/// Trim the labels of `choices` and check them. A violation is `InvalidValue`.
pub fn normalize_choices(choices: Vec<Choice>) -> Result<Vec<Choice>, SkanError> {
    let normalized: Vec<Choice> = choices
        .into_iter()
        .map(|c| Choice {
            id: c.id,
            label: c.label.trim().to_string(),
        })
        .collect();
    match choice_defect(&normalized) {
        None => Ok(normalized),
        Some(d) => Err(SkanError::InvalidValue {
            field: d.field,
            reason: d.reason,
        }),
    }
}

/// Normalize line endings (CRLF to LF), trim the outer whitespace, and require
/// 1 to 2,000 characters. This is the rule of a decision request's question.
pub fn normalize_question(text: &str) -> Result<String, SkanError> {
    let normalized = text.replace("\r\n", "\n");
    let trimmed = normalized.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > 2_000 {
        return Err(SkanError::InvalidValue {
            field: "question".into(),
            reason: "Questions must be 1 to 2000 characters.".into(),
        });
    }
    Ok(trimmed.to_string())
}

/// Normalize a free-text answer. Blank text counts as no text (`None`). Text
/// over 2,000 characters is `InvalidValue`.
pub fn normalize_answer_text(text: &str) -> Result<Option<String>, SkanError> {
    let normalized = text.replace("\r\n", "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > 2_000 {
        return Err(SkanError::InvalidValue {
            field: "text".into(),
            reason: "Answers must be 2,000 characters or fewer.".into(),
        });
    }
    Ok(Some(trimmed.to_string()))
}

/// Accept only `formatVersion: 1`. A missing version is `file_invalid`; any
/// other version is `format_unsupported`. Nothing is converted.
pub fn check_format_version(value: &Value, file: &str) -> Result<(), SkanError> {
    match value.get("formatVersion") {
        None => Err(SkanError::FileInvalid {
            file: file.to_string(),
            field: "formatVersion".into(),
            reason: "formatVersion is required.".into(),
        }),
        Some(version) if version.as_u64() == Some(1) => Ok(()),
        Some(version) => Err(SkanError::FormatUnsupported {
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
