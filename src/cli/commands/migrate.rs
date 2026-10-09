use crate::cli::Outcome;
use crate::cli::args::MigrateArgs;
use crate::error::SkanError;
use serde_json::json;

pub fn run(_args: &MigrateArgs, db_path: &std::path::Path) -> Result<Outcome, SkanError> {
    if let Some(dir) = db_path.parent()
        && let Some(info) = crate::paths::read_serve_info_in(dir)
        && crate::server::is_serving(&info)
    {
        return Err(SkanError::DatabaseError {
            reason: "Stop the running agboard serve before migrating.".into(),
        });
    }
    let report = crate::store::migrations::migrate(db_path)?;
    let changed = report.changed;
    Ok(Outcome {
        changed,
        human: if changed {
            format!("Migrated board to schema {}.\n", report.to)
        } else {
            "Board is already current.\n".into()
        },
        json: json!(report),
    })
}
