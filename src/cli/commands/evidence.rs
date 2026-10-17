//! `evidence add|show|rm`: a task's UTF-8 text evidence. The CLI is the agent
//! side, so a draft task refuses changes here; `rm` also needs a person at a
//! terminal.

use std::io::{BufRead, Write};

use serde_json::json;

use crate::cli::args::{EvidenceAddArgs, EvidenceArgs, EvidenceCommand, EvidenceIdArgs};
use crate::cli::{Context, Outcome};
use crate::error::{AgboardError, FileAction};
use crate::interact::confirm;

pub fn run(ctx: &mut Context, args: &EvidenceArgs) -> Result<Outcome, AgboardError> {
    match &args.command {
        EvidenceCommand::Add(args) => add(ctx, args),
        EvidenceCommand::Show(args) => show(ctx, args),
        EvidenceCommand::Rm(args) => {
            ctx.interactive |= confirm::is_interactive(ctx.json);
            rm_with_io(
                ctx,
                args,
                &mut std::io::stdin().lock(),
                &mut std::io::stderr(),
            )
        }
    }
}

/// The path of an evidence file as TASK.md refers to it.
fn relative_path(evidence_id: &str) -> String {
    format!("evidence/{evidence_id}.log")
}

fn add(ctx: &mut Context, args: &EvidenceAddArgs) -> Result<Outcome, AgboardError> {
    let bytes = std::fs::read(&args.path).map_err(|e| AgboardError::FileError {
        action: FileAction::Read,
        file: args.path.display().to_string(),
        reason: e.to_string(),
    })?;
    let name = match &args.name {
        Some(name) => name.clone(),
        None => args
            .path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or_default()
            .to_owned(),
    };
    let record = ctx.files.add_evidence(
        ctx.project_id()?,
        args.task_id,
        &name,
        &bytes,
        ctx.clock.now(),
    )?;
    let path = relative_path(&record.id);
    Ok(Outcome {
        changed: true,
        human: format!(
            "Added evidence {} to #{}: {path}\n",
            record.id, args.task_id
        ),
        json: json!({"taskId": args.task_id, "evidence": record, "path": path}),
    })
}

fn show(ctx: &mut Context, args: &EvidenceIdArgs) -> Result<Outcome, AgboardError> {
    let data = ctx
        .files
        .read_evidence(ctx.project_id()?, args.task_id, &args.evidence_id)?;
    let text = String::from_utf8_lossy(&data.bytes).into_owned();
    Ok(Outcome {
        changed: false,
        human: text.clone(),
        json: json!({"taskId": args.task_id, "evidence": data.record, "text": text}),
    })
}

/// Delete a task's evidence after a person confirms it at a terminal.
pub fn rm_with_io(
    ctx: &Context,
    args: &EvidenceIdArgs,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<Outcome, AgboardError> {
    let project = ctx.project_id()?;
    let task = ctx.files.task(project, args.task_id)?;
    if !task.evidence.iter().any(|e| e.id == args.evidence_id) {
        return Err(AgboardError::EvidenceNotFound {
            id: args.evidence_id.clone(),
        });
    }
    // The task's state is checked before a person is asked, so no confirmation
    // is requested for a removal that cannot happen.
    if task.archived_at.is_some() {
        return Err(AgboardError::TaskArchived { id: args.task_id });
    }
    if task.is_draft {
        return Err(AgboardError::TaskIsDraft { id: args.task_id });
    }
    if ctx.json || !ctx.interactive {
        return Err(AgboardError::ConfirmationRequired {
            operation: "deleting evidence".into(),
        });
    }
    if !confirm::confirm(
        &format!(
            "Delete evidence {} of #{}? This cannot be undone.",
            args.evidence_id, args.task_id
        ),
        input,
        output,
    )? {
        return Ok(Outcome {
            changed: false,
            human: "Cancelled. Nothing was changed.\n".into(),
            json: json!({"cancelled": true}),
        });
    }
    ctx.files
        .delete_evidence(project, args.task_id, &args.evidence_id, ctx.clock.now())?;
    Ok(Outcome {
        changed: true,
        human: format!(
            "Deleted evidence {} from #{}.\n",
            args.evidence_id, args.task_id
        ),
        json: json!({"taskId": args.task_id, "deleted": args.evidence_id}),
    })
}
