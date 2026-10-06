use crate::cli::args::LsArgs;
use crate::cli::{Context, Outcome};
use crate::{domain::Column, error::SkanError};
use serde_json::json;

pub fn run(ctx: &mut Context, args: &LsArgs) -> Result<Outcome, SkanError> {
    let cards: Vec<_> = ctx
        .store
        .snapshot(ctx.project_id()?)?
        .cards
        .into_iter()
        .filter(|card| {
            args.column.is_none_or(|c| card.card_status == c.column())
                && args
                    .state
                    .is_none_or(|s| card.agent_status == s.run_state())
        })
        .collect();
    let text = crate::cli::output::ls_text(&cards, &[Column::Todo, Column::Doing, Column::Done]);
    Ok(Outcome {
        changed: false,
        human: text,
        json: json!({"cards": cards}),
    })
}
