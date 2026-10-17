use crate::cli::args::AddArgs;
use crate::cli::{Context, Outcome};
use crate::domain::{Actor, NewTask};
use crate::error::AgboardError;
use crate::file_store::validate::EpicId;
use serde_json::json;

pub fn run(ctx: &mut Context, args: &AddArgs) -> Result<Outcome, AgboardError> {
    let mut stdin = std::io::stdin();
    let description = args.description.resolve(&mut stdin)?.unwrap_or_default();
    // The epic is checked before the task is written, so a wrong EPIC-ID creates nothing.
    let epic = args.epic.as_deref().map(EpicId::normalize).transpose()?;
    if let Some(id) = &epic {
        ctx.files.epic(ctx.project_id()?, id)?;
    }
    let project = ctx.project_id()?.clone();
    let mut task = ctx.files.create_task(
        &project,
        NewTask {
            title: args.title.clone(),
            description,
            assignee: args.assignee.assignee(),
            actor: args.actor.actor(),
            is_draft: false,
        },
        ctx.clock.now(),
    )?;
    if let Some(id) = &epic {
        task = ctx
            .files
            .set_task_epic(&project, task.id, Some(id), Actor::Ai, ctx.clock.now())?
            .value;
    }
    Ok(Outcome {
        changed: true,
        human: format!("Created #{} {}.\n", task.id, task.title),
        json: json!({"task": task}),
    })
}
