use crate::cli::args::EditArgs;
use crate::cli::{Context, Outcome};
use crate::domain::Actor;
use crate::error::SkanError;
use crate::file_store::validate::EpicId;
use serde_json::json;

pub fn run(ctx: &mut Context, args: &EditArgs) -> Result<Outcome, SkanError> {
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
    let mut card = None;
    if args.title.is_some() || description.is_some() {
        let result = ctx.files.edit_card(
            &project,
            args.id,
            args.title.as_deref(),
            description.as_deref(),
            ctx.clock.now(),
        )?;
        changed |= result.changed;
        card = Some(result.value);
    }
    if let Some(target) = &epic {
        let result = ctx.files.set_card_epic(
            &project,
            args.id,
            target.as_ref(),
            Actor::Ai,
            ctx.clock.now(),
        )?;
        changed |= result.changed;
        card = Some(result.value);
    }
    let card = match card {
        Some(card) => card,
        None => ctx.files.card(&project, args.id)?,
    };
    Ok(Outcome {
        changed,
        human: format!("Updated #{}.\n", args.id),
        json: json!({"card": card}),
    })
}
