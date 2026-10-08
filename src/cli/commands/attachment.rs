use std::fs::{self, OpenOptions};
use std::io::Write;

use crate::cli::args::{AttachmentAddArgs, AttachmentCommand, AttachmentGetArgs, AttachmentLsArgs};
use crate::cli::{Context, Outcome};
use crate::domain::AttachmentInput;
use crate::error::{FileAction, SkanError};
use serde_json::json;

pub fn run(
    ctx: &mut Context,
    args: &crate::cli::args::AttachmentArgs,
) -> Result<Outcome, SkanError> {
    match &args.command {
        AttachmentCommand::Ls(args) => list(ctx, args),
        AttachmentCommand::Add(args) => add(ctx, args),
        AttachmentCommand::Get(args) => get(ctx, args),
    }
}

fn list(ctx: &mut Context, args: &AttachmentLsArgs) -> Result<Outcome, SkanError> {
    let attachments = ctx.store.attachments(ctx.project_id()?, args.card_id)?;
    let human = if attachments.is_empty() {
        format!("#{} has no attachments.\n", args.card_id)
    } else {
        attachments
            .iter()
            .map(|a| format!("{} {} {} {}\n", a.id, a.name, a.media_type, a.size))
            .collect()
    };
    Ok(Outcome {
        changed: false,
        human,
        json: json!({"cardId": args.card_id, "attachments": attachments}),
    })
}

fn add(ctx: &mut Context, args: &AttachmentAddArgs) -> Result<Outcome, SkanError> {
    let bytes = fs::read(&args.file).map_err(|e| file_error(&args.file, FileAction::Read, e))?;
    let id = random_id()?;
    let request_id = random_id()?;
    let card = ctx.store.add_attachment(
        ctx.project_id()?,
        args.card_id,
        AttachmentInput {
            id,
            name: args
                .file
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or_default()
                .to_owned(),
            bytes,
        },
        &request_id,
        ctx.clock.now(),
    )?;
    let attachment = card.attachments.last().expect("new attachment is returned");
    Ok(Outcome {
        changed: true,
        human: format!("Added attachment {} to #{}.\n", attachment.id, args.card_id),
        json: json!({"cardId": args.card_id, "attachment": attachment}),
    })
}

fn get(ctx: &mut Context, args: &AttachmentGetArgs) -> Result<Outcome, SkanError> {
    let data =
        ctx.store
            .attachment_data_for_card(ctx.project_id()?, args.card_id, &args.attachment_id)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&args.output)
        .map_err(|e| file_error(&args.output, FileAction::Write, e))?;
    if let Err(e) = file.write_all(&data.bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&args.output);
        return Err(file_error(&args.output, FileAction::Write, e));
    }
    Ok(Outcome {
        changed: false,
        human: format!("Wrote attachment to {}.\n", args.output.display()),
        json: json!({"path": args.output, "attachment": data.metadata}),
    })
}

fn random_id() -> Result<String, SkanError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| SkanError::DatabaseError {
        reason: e.to_string(),
    })?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn file_error(path: &std::path::Path, action: FileAction, error: std::io::Error) -> SkanError {
    SkanError::FileError {
        action,
        file: path.display().to_string(),
        reason: error.to_string(),
    }
}
