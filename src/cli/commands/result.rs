//! `result ls|add`: the results delivered to the requester. Recording one is
//! a work note, so the lane and the run state stay as they are.

use std::fs;

use crate::cli::args::{ResultAddArgs, ResultArgs, ResultCommand, ResultLsArgs};
use crate::cli::{Context, Outcome};
use crate::domain::{AttachmentInput, ResultKind};
use crate::error::{AgboardError, FileAction};
use crate::file_store::{ResultInput, layout};
use serde_json::json;

pub fn run(ctx: &mut Context, args: &ResultArgs) -> Result<Outcome, AgboardError> {
    match &args.command {
        ResultCommand::Ls(args) => list(ctx, args),
        ResultCommand::Add(args) => add(ctx, args),
    }
}

fn list(ctx: &mut Context, args: &ResultLsArgs) -> Result<Outcome, AgboardError> {
    let results = ctx.files.task(ctx.project_id()?, args.task_id)?.results;
    let human = if results.is_empty() {
        format!("#{} has no results.\n", args.task_id)
    } else {
        results
            .iter()
            .map(|r| {
                format!(
                    "v{} {} {} {}\n",
                    r.version,
                    r.kind.as_str(),
                    crate::clock::format_utc(r.at),
                    r.summary.lines().next().unwrap_or_default()
                )
            })
            .collect()
    };
    Ok(Outcome {
        changed: false,
        human,
        json: json!({"taskId": args.task_id, "results": results}),
    })
}

fn add(ctx: &mut Context, args: &ResultAddArgs) -> Result<Outcome, AgboardError> {
    let mut images = Vec::new();
    for path in &args.file {
        let bytes = fs::read(path).map_err(|e| AgboardError::FileError {
            action: FileAction::Read,
            file: path.display().to_string(),
            reason: e.to_string(),
        })?;
        images.push(AttachmentInput {
            id: crate::file_store::io::random_hex(16).map_err(|e| AgboardError::FileError {
                action: FileAction::Write,
                file: "attachment".into(),
                reason: e.to_string(),
            })?,
            name: path
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or_default()
                .to_owned(),
            bytes,
        });
    }
    let recorded = ctx.files.add_result(
        ctx.project_id()?,
        args.task_id,
        ResultInput {
            kind: if args.is_final {
                ResultKind::Final
            } else {
                ResultKind::Progress
            },
            summary: args.summary.clone(),
            link: args.link.clone(),
            images,
            key: args.key.clone(),
        },
        ctx.clock.now(),
    )?;
    let result = &recorded.result;
    let paths: Vec<String> = recorded
        .attachments
        .iter()
        .map(|a| {
            let ext = layout::asset_extension(&a.media_type).unwrap_or("png");
            format!("assets/{}.{ext}", a.id)
        })
        .collect();
    let human = if recorded.created {
        format!(
            "Recorded {} result v{} on #{}.\n",
            result.kind.as_str(),
            result.version,
            args.task_id
        )
    } else {
        format!(
            "Result v{} was already recorded on #{}; nothing changed.\n",
            result.version, args.task_id
        )
    };
    Ok(Outcome {
        changed: recorded.created,
        human,
        json: json!({
            "taskId": args.task_id,
            "result": result,
            "created": recorded.created,
            "attachment": recorded.attachments.first(),
            "path": paths.first(),
            "attachments": recorded.attachments,
            "paths": paths,
        }),
    })
}
