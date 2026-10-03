use serde_json::json;

use crate::cli::args::LsArgs;
use crate::cli::output::{card_value, ls_text};
use crate::cli::{Context, Outcome};
use crate::domain::Column;
use crate::error::SkanError;

pub fn run(ctx: &mut Context, args: &LsArgs) -> Result<Outcome, SkanError> {
    let column = args.column.map(|c| c.column());
    let state = args.state.map(|s| s.run_state());
    let cards = ctx.store.list_cards(column, state)?;
    let columns = match column {
        Some(column) => vec![column],
        None => vec![Column::Todo, Column::Doing, Column::Done],
    };
    let values: Vec<_> = cards.iter().map(card_value).collect();
    Ok(Outcome {
        changed: false,
        human: ls_text(&cards, &columns),
        json: json!({"cards": values}),
    })
}
