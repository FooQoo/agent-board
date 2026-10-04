use crate::cli::args::MvArgs;
use crate::cli::{Context, Outcome};
use crate::{domain::ChangeContext, error::SkanError};
use serde_json::json;

pub fn run(ctx: &mut Context, args: &MvArgs) -> Result<Outcome, SkanError> {
    let reason = args.change.resolve_reason()?;
    let changed = ctx.store.move_work_card(
        args.id,
        args.column.column(),
        ChangeContext {
            actor: args.change.actor.actor(),
            reason,
        },
        ctx.clock.now(),
    )?;
    let human = if changed.changed {
        format!("Moved #{} to {}.\n", args.id, args.column.column().as_str())
    } else {
        format!(
            "#{} is already in {}.\n",
            args.id,
            args.column.column().as_str()
        )
    };
    Ok(Outcome {
        changed: changed.changed,
        human,
        json: json!({"card": changed.value}),
    })
}
