//! `agboard progress`: the tasks an agent can pick up, by epic in priority
//! order. The table is built by `crate::progress`, the same code the hook uses.

use std::fmt::Write as _;

use serde_json::json;

use crate::cli::{Context, Outcome};
use crate::domain::{Assignee, Column, RunState};
use crate::error::AgboardError;
use crate::progress::{self, Progress, ProgressTask};

pub fn run(ctx: &Context) -> Result<Outcome, AgboardError> {
    let snapshot = ctx.files.board(ctx.project_id()?)?;
    let table = progress::build(&snapshot, ctx.files.shared_dir(), ctx.clock.now());
    Ok(Outcome {
        changed: false,
        human: render(&table),
        json: json!(table),
    })
}

/// The table for a person: one block per epic, then the unassigned tasks.
pub fn render(table: &Progress) -> String {
    let mut out = String::new();
    for epic in &table.epics {
        let _ = writeln!(out, "{} {}", epic.id, epic.name);
        for task in &epic.tasks {
            write_task(&mut out, task);
        }
        out.push('\n');
    }
    if !table.unassigned.is_empty() {
        out.push_str("Unassigned\n");
        for task in &table.unassigned {
            write_task(&mut out, task);
        }
    }
    if out.is_empty() {
        out.push_str("No tasks to pick up.\n");
    }
    out
}

fn write_task(out: &mut String, task: &ProgressTask) {
    let assignee = match task.assignee {
        Assignee::Ai => "ai",
        Assignee::Human => "human",
    };
    let column = match task.task_status {
        Column::Todo => "todo",
        Column::Doing => "doing",
        Column::Done => "done",
    };
    let state = match task.agent_status {
        RunState::Idle => "idle",
        RunState::Running => "running",
        RunState::Pending => "pending",
    };
    let draft = if task.is_draft { ", draft" } else { "" };
    let _ = writeln!(
        out,
        "  #{} {} [{assignee}, {column}, {state}{draft}] acceptance {}/{}",
        task.id, task.title, task.acceptance.done, task.acceptance.total
    );
}
