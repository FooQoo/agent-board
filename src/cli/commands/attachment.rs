//! `attachment ls|add|get`: a task's images, kept in the task's `assets/`
//! folder. The CLI is the agent side, so a draft task refuses an addition.

use std::fs::{self, OpenOptions};
use std::io::Write;

use crate::cli::args::{AttachmentAddArgs, AttachmentCommand, AttachmentGetArgs, AttachmentLsArgs};
use crate::cli::{Context, Outcome};
use crate::domain::AttachmentInput;
use crate::error::{AgboardError, FileAction};
use crate::file_store::layout;
use crate::file_store::model::AttachmentOwner;
use serde_json::json;

pub fn run(
    ctx: &mut Context,
    args: &crate::cli::args::AttachmentArgs,
) -> Result<Outcome, AgboardError> {
    match &args.command {
        AttachmentCommand::Ls(args) => list(ctx, args),
        AttachmentCommand::Add(args) => add(ctx, args),
        AttachmentCommand::Get(args) => get(ctx, args),
    }
}

fn list(ctx: &mut Context, args: &AttachmentLsArgs) -> Result<Outcome, AgboardError> {
    let attachments = ctx.files.task(ctx.project_id()?, args.task_id)?.attachments;
    let human = if attachments.is_empty() {
        format!("#{} has no attachments.\n", args.task_id)
    } else {
        attachments
            .iter()
            .map(|a| format!("{} {} {} {}\n", a.id, a.name, a.media_type, a.size))
            .collect()
    };
    Ok(Outcome {
        changed: false,
        human,
        json: json!({"taskId": args.task_id, "attachments": attachments}),
    })
}

fn add(ctx: &mut Context, args: &AttachmentAddArgs) -> Result<Outcome, AgboardError> {
    let bytes = fs::read(&args.file).map_err(|e| file_error(&args.file, FileAction::Read, e))?;
    let id = random_id()?;
    let attachment = ctx.files.add_attachment(
        ctx.project_id()?,
        &AttachmentOwner::Task(args.task_id),
        AttachmentInput {
            id: id.clone(),
            name: args
                .file
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or_default()
                .to_owned(),
            bytes,
        },
        ctx.clock.now(),
    )?;
    let ext = layout::asset_extension(&attachment.media_type).unwrap_or("png");
    let path = format!("assets/{id}.{ext}");
    Ok(Outcome {
        changed: true,
        human: format!(
            "Added attachment {} to #{}: {path}\n",
            attachment.id, args.task_id
        ),
        json: json!({"taskId": args.task_id, "attachment": attachment, "path": path}),
    })
}

fn get(ctx: &mut Context, args: &AttachmentGetArgs) -> Result<Outcome, AgboardError> {
    let stored = ctx.files.attachment_path(
        ctx.project_id()?,
        &AttachmentOwner::Task(args.task_id),
        &args.attachment_id,
    )?;
    let bytes =
        fs::read(&stored.path).map_err(|e| file_error(&stored.path, FileAction::Read, e))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&args.output)
        .map_err(|e| file_error(&args.output, FileAction::Write, e))?;
    if let Err(e) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&args.output);
        return Err(file_error(&args.output, FileAction::Write, e));
    }
    Ok(Outcome {
        changed: false,
        human: format!("Wrote attachment to {}.\n", args.output.display()),
        json: json!({"path": args.output, "attachment": stored.metadata}),
    })
}

fn random_id() -> Result<String, AgboardError> {
    crate::file_store::io::random_hex(16).map_err(|e| AgboardError::FileError {
        action: FileAction::Write,
        file: "attachment".into(),
        reason: e.to_string(),
    })
}

fn file_error(path: &std::path::Path, action: FileAction, error: std::io::Error) -> AgboardError {
    AgboardError::FileError {
        action,
        file: path.display().to_string(),
        reason: error.to_string(),
    }
}
