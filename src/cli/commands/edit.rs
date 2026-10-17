use crate::cli::args::EditArgs;
use crate::cli::{Context, Outcome};
use crate::domain::Actor;
use crate::error::AgboardError;
use crate::file_store::validate::EpicId;
use serde_json::json;

pub fn run(ctx: &mut Context, args: &EditArgs) -> Result<Outcome, AgboardError> {
    let mut stdin = std::io::stdin();
    let description = args.description.resolve(&mut stdin)?;
    // The target epic is checked first, so a wrong EPIC-ID changes nothing.
    let epic: Option<Option<EpicId>> = if args.clear_epic {
        Some(None)
    } else if let Some(raw) = &args.epic {
        Some(Some(EpicId::normalize(raw)?))
    } else {
        None
    };
    let project = ctx.project_id()?.clone();
    if let Some(Some(id)) = &epic {
        ctx.files.epic(&project, id)?;
    }
    let mut changed = false;
    let mut task = None;
    if args.title.is_some() || description.is_some() {
        let result = ctx.files.edit_task(
            &project,
            args.id,
            args.title.as_deref(),
            description.as_deref(),
            ctx.clock.now(),
        )?;
        changed |= result.changed;
        task = Some(result.value);
    }
    if let Some(target) = &epic {
        let result = ctx.files.set_task_epic(
            &project,
            args.id,
            target.as_ref(),
            Actor::Ai,
            ctx.clock.now(),
        )?;
        changed |= result.changed;
        task = Some(result.value);
    }
    let task = match task {
        Some(task) => task,
        None => ctx.files.task(&project, args.id)?,
    };
    Ok(Outcome {
        changed,
        human: format!("Updated #{}.\n", args.id),
        json: json!({"task": task}),
    })
}
