use crate::{
    cli::{Context, Outcome},
    clock::format_utc,
    domain::FetchedSnapshot,
    error::SkanError,
};

pub fn run(ctx: &mut Context) -> Result<Outcome, SkanError> {
    let fetched_at = format_utc(ctx.clock.now());
    let snapshot = ctx.store.snapshot(ctx.project_id()?)?;
    let json = serde_json::to_value(FetchedSnapshot {
        fetched_at,
        snapshot: &snapshot,
    })
    .expect("snapshot serializes");
    Ok(Outcome {
        changed: false,
        human: String::new(),
        json,
    })
}
