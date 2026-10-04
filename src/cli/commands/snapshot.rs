use serde::Serialize;

use crate::{
    cli::{Context, Outcome},
    clock::format_utc,
    error::SkanError,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot<'a> {
    fetched_at: String,
    revision: i64,
    board: &'a crate::domain::BoardMeta,
    cards: &'a [crate::domain::Card],
}

pub fn run(ctx: &mut Context) -> Result<Outcome, SkanError> {
    let fetched_at = format_utc(ctx.clock.now());
    let snapshot = ctx.store.snapshot()?;
    let payload = Snapshot {
        fetched_at,
        revision: snapshot.revision,
        board: &snapshot.board,
        cards: &snapshot.cards,
    };
    let json = serde_json::to_value(payload).expect("snapshot serializes");
    Ok(Outcome {
        changed: false,
        human: String::new(),
        json,
    })
}
