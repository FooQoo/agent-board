//! Reading and validating export files.
//!
//! Dates are read as text first so that a bad date is reported with the
//! card it belongs to instead of as an anonymous JSON error.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;

use crate::clock::parse_utc;
use crate::domain::{BoardMeta, BoardSnapshot, Card, Column, RunState, Transition};
use crate::error::{FileAction, SkanError};

use super::{ExportFile, FORMAT, VERSION};

type Violation = String;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawFile {
    #[allow(dead_code)] // checked on the untyped value first
    format: String,
    #[allow(dead_code)]
    version: u32,
    board: RawBoard,
    cards: Vec<RawCard>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawBoard {
    name: String,
    next_card_id: i64,
    created_at: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCard {
    id: i64,
    title: String,
    description: String,
    column: Column,
    position: i64,
    run_state: RunState,
    pending_reason: Option<String>,
    created_at: String,
    updated_at: String,
    run_state_changed_at: String,
    transitions: Vec<RawTransition>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawTransition {
    from: Option<Column>,
    to: Column,
    at: String,
}

fn format_violation() -> Violation {
    format!("The format must be \"{FORMAT}\" with version {VERSION}.")
}

fn parse_date(text: &str, owner: impl FnOnce() -> String) -> Result<DateTime<Utc>, Violation> {
    parse_utc(text).map_err(|_| format!("{} has an invalid date: \"{text}\".", owner()))
}

fn convert_card(raw: RawCard) -> Result<Card, Violation> {
    let owner = || format!("Card #{}", raw.id);
    let created_at = parse_date(&raw.created_at, owner)?;
    let updated_at = parse_date(&raw.updated_at, owner)?;
    let run_state_changed_at = parse_date(&raw.run_state_changed_at, owner)?;
    let mut transitions = Vec::with_capacity(raw.transitions.len());
    for transition in &raw.transitions {
        transitions.push(Transition {
            from: transition.from,
            to: transition.to,
            at: parse_date(&transition.at, owner)?,
        });
    }
    Ok(Card {
        id: raw.id,
        title: raw.title,
        description: raw.description,
        column: raw.column,
        position: raw.position,
        run_state: raw.run_state,
        pending_reason: raw.pending_reason,
        created_at,
        updated_at,
        run_state_changed_at,
        transitions,
    })
}

fn convert(raw: RawFile) -> Result<ExportFile, Violation> {
    let board = BoardMeta {
        name: raw.board.name,
        next_card_id: raw.board.next_card_id,
        created_at: parse_date(&raw.board.created_at, || "The board".to_string())?,
    };
    let cards = raw
        .cards
        .into_iter()
        .map(convert_card)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ExportFile {
        format: FORMAT.to_string(),
        version: VERSION,
        board,
        cards,
    })
}

/// Check every import rule in the order MODEL.md lists them.
fn check(file: &ExportFile) -> Result<BoardSnapshot, Violation> {
    if file.format != FORMAT || file.version != VERSION {
        return Err(format_violation());
    }
    let mut cards = file.cards.clone();
    cards.sort_by_key(|card| card.id);
    Ok(BoardSnapshot {
        board: file.board.clone(),
        cards,
    })
}

fn invalid(file: &str, reason: Violation) -> SkanError {
    SkanError::ImportInvalid {
        file: file.to_string(),
        reason,
    }
}

/// Check every import rule and return the first violation as `ImportInvalid`.
/// The error names `skan.json`; [`read_and_validate`] names the real path. The
/// returned snapshot has its cards in ascending ID order.
pub fn validate(file: &ExportFile) -> Result<BoardSnapshot, SkanError> {
    check(file).map_err(|reason| invalid(super::DEFAULT_FILE_NAME, reason))
}

/// Read `path` and validate it. Unreadable files are `FileError`; files that
/// are not valid board files are `ImportInvalid`. The format is checked before
/// anything else, so a file of another kind is reported as such.
pub fn read_and_validate(path: &Path) -> Result<BoardSnapshot, SkanError> {
    let name = path.display().to_string();
    let bytes = fs::read(path).map_err(|error| SkanError::FileError {
        action: FileAction::Read,
        file: name.clone(),
        reason: error.to_string(),
    })?;
    let parse_error =
        |error: serde_json::Error| invalid(&name, format!("Cannot parse the file: {error}."));

    let value: Value = serde_json::from_slice(&bytes).map_err(parse_error)?;
    let format_ok = value.get("format").and_then(Value::as_str) == Some(FORMAT)
        && value.get("version").and_then(Value::as_u64) == Some(u64::from(VERSION));
    if !format_ok {
        return Err(invalid(&name, format_violation()));
    }

    let raw: RawFile = serde_json::from_slice(&bytes).map_err(parse_error)?;
    let file = convert(raw).map_err(|reason| invalid(&name, reason))?;
    check(&file).map_err(|reason| invalid(&name, reason))
}
