use crate::cli::args::AddArgs;
use crate::cli::{Context, Outcome};
use crate::{domain::NewCard, error::SkanError};
use serde_json::json;

pub fn run(ctx: &mut Context, args: &AddArgs) -> Result<Outcome, SkanError> {
    let mut stdin = std::io::stdin();
    let description = args.description.resolve(&mut stdin)?.unwrap_or_default();
    let card = ctx.files.create_card(
        ctx.project_id()?,
        NewCard {
            title: args.title.clone(),
            description,
            assignee: args.assignee.assignee(),
            actor: args.actor.actor(),
        },
        ctx.clock.now(),
    )?;
    Ok(Outcome {
        changed: true,
        human: format!("Created #{} {}.\n", card.id, card.title),
        json: json!({"card": card}),
    })
}
