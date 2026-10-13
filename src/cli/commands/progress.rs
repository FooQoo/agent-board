//! `agboard progress`: the cards an agent can pick up, by epic in priority
//! order. The table is built by `crate::progress`, the same code the hook uses.

use std::fmt::Write as _;

use serde_json::json;

use crate::cli::{Context, Outcome};
use crate::domain::{Assignee, Column, RunState};
use crate::error::AgboardError;
use crate::progress::{self, Progress, ProgressCard};

pub fn run(ctx: &Context) -> Result<Outcome, AgboardError> {
    let snapshot = ctx.files.board(ctx.project_id()?)?;
    let table = progress::build(&snapshot, ctx.files.shared_dir(), ctx.clock.now());
    Ok(Outcome {
        changed: false,
        human: render(&table),
        json: json!(table),
    })
}

/// The table for a person: one block per epic, then the unassigned cards.
pub fn render(table: &Progress) -> String {
    let mut out = String::new();
    for epic in &table.epics {
        let _ = writeln!(
            out,
            "{} {} (acceptance {}/{})",
            epic.id, epic.name, epic.acceptance.done, epic.acceptance.total
        );
        for card in &epic.cards {
            write_card(&mut out, card);
        }
        out.push('\n');
    }
    if !table.unassigned.is_empty() {
        out.push_str("Unassigned\n");
        for card in &table.unassigned {
            write_card(&mut out, card);
        }
    }
    if out.is_empty() {
        out.push_str("No cards to pick up.\n");
    }
    out
}

fn write_card(out: &mut String, card: &ProgressCard) {
    let assignee = match card.assignee {
        Assignee::Ai => "ai",
        Assignee::Human => "human",
    };
    let column = match card.card_status {
        Column::Todo => "todo",
        Column::Doing => "doing",
        Column::Done => "done",
    };
    let state = match card.agent_status {
        RunState::Idle => "idle",
        RunState::Running => "running",
        RunState::Pending => "pending",
    };
    let draft = if card.is_draft { ", draft" } else { "" };
    let _ = writeln!(
        out,
        "  #{} {} [{assignee}, {column}, {state}{draft}] acceptance {}/{}",
        card.id, card.title, card.acceptance.done, card.acceptance.total
    );
}
