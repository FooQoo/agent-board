use crate::cli::args::{ShowArgs, ShowCommand};
use crate::cli::{Context, Outcome};
use crate::error::AgboardError;
use serde_json::json;

pub fn run(ctx: &mut Context, args: &ShowArgs) -> Result<Outcome, AgboardError> {
    if let Some(ShowCommand::Remote) = &args.command {
        let meta = ctx.project()?;
        let data_dir = ctx
            .files
            .shared_dir()
            .parent()
            .filter(|dir| !dir.as_os_str().is_empty())
            .unwrap_or_else(|| std::path::Path::new("."))
            .to_path_buf();
        return super::remote::run(
            &data_dir,
            Some((meta.id.to_string(), meta.name.clone())),
            &*crate::remote_settings::vault_from_process(),
        );
    }
    let Some(id) = args.id else {
        return Err(AgboardError::InvalidArgument {
            message: "give the ID of the task to show, or \"remote\" to show the remote access."
                .to_string(),
            command: Some("show".to_string()),
        });
    };
    let task = ctx.files.task(ctx.project_id()?, id)?;
    let human = crate::cli::output::show_text(&task);
    Ok(Outcome {
        changed: false,
        human,
        json: json!({"task": task}),
    })
}
