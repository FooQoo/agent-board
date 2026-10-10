//! `agboard project create|ls|rename|rm`: managing the projects themselves.
//!
//! `create` and `ls` work on the catalog and name no project. `rename` and
//! `rm` act on the one project resolved from `--project` before the command
//! ran; they use its ID from then on, so a deletion, a rename or a same-name
//! re-creation in the meantime can never redirect them to another project.

use std::io::{BufRead, Write};

use serde_json::json;

use crate::cli::args::{ProjectArgs, ProjectCommand, ProjectCreateArgs, ProjectRenameArgs};
use crate::cli::{Context, Outcome};
use crate::error::SkanError;
use crate::interact::confirm;

pub fn run(ctx: &mut Context, args: &ProjectArgs) -> Result<Outcome, SkanError> {
    match &args.command {
        ProjectCommand::Create(args) => create(ctx, args),
        ProjectCommand::Ls => ls(ctx),
        ProjectCommand::Rename(args) => rename(ctx, args),
        ProjectCommand::Rm => rm(ctx),
    }
}

/// Create an empty project. A name already in use is `project_name_exists`.
pub fn create(ctx: &Context, args: &ProjectCreateArgs) -> Result<Outcome, SkanError> {
    let project = ctx.files.create_project(&args.name, ctx.clock.now())?;
    Ok(Outcome {
        changed: true,
        human: format!("Created project \"{}\".\n", project.name),
        json: json!({"project": project}),
    })
}

/// The projects by name, with the catalog revision.
pub fn ls(ctx: &Context) -> Result<Outcome, SkanError> {
    let catalog = ctx.files.catalog()?;
    Ok(list_outcome(
        serde_json::to_value(&catalog).expect("catalog serializes"),
        catalog.projects.iter().map(|p| p.name.as_str()),
    ))
}

/// Shown instead of an empty project list.
pub const NO_PROJECTS: &str = "No projects. Create one with: agboard project create NAME\n";

fn list_outcome<'a>(value: serde_json::Value, names: impl Iterator<Item = &'a str>) -> Outcome {
    let mut human = String::new();
    for name in names {
        human.push_str(name);
        human.push('\n');
    }
    if human.is_empty() {
        human = NO_PROJECTS.to_string();
    }
    Outcome {
        changed: false,
        human,
        json: value,
    }
}

/// Rename the resolved project, keeping its ID. The same normalized name is
/// a success that changes nothing.
pub fn rename(ctx: &Context, args: &ProjectRenameArgs) -> Result<Outcome, SkanError> {
    let current = ctx.project()?;
    let old_name = current.name.clone();
    let renamed = ctx.files.rename_project(&current.id, &args.new_name)?;
    let human = if renamed.changed {
        format!(
            "Renamed project \"{old_name}\" to \"{}\".\n",
            renamed.value.name
        )
    } else {
        format!(
            "Project \"{}\" already has this name. Nothing was changed.\n",
            renamed.value.name
        )
    };
    Ok(Outcome {
        changed: renamed.changed,
        human,
        json: json!({"project": renamed.value}),
    })
}

pub fn rm(ctx: &mut Context) -> Result<Outcome, SkanError> {
    ctx.interactive |= confirm::is_interactive(ctx.json);
    rm_with_io(ctx, &mut std::io::stdin().lock(), &mut std::io::stderr())
}

/// Delete the resolved project and all its cards and history, only after a
/// human confirms. A human can be asked only when `ctx.interactive` is set and
/// `ctx.json` is not; otherwise nothing is deleted. The ID was fixed before
/// the question: if the project is gone when the answer arrives, this is
/// `project_not_found`, never another project of the same name.
pub fn rm_with_io(
    ctx: &Context,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<Outcome, SkanError> {
    let project = ctx.project()?;
    if ctx.json || !ctx.interactive {
        return Err(SkanError::ConfirmationRequired {
            operation: "deleting a project".to_string(),
        });
    }
    let prompt = format!(
        "Delete project {} and all its cards and history?",
        project.name
    );
    if !confirm::confirm(&prompt, input, output)? {
        return Ok(Outcome {
            changed: false,
            human: "Cancelled. Nothing was changed.\n".to_string(),
            json: json!({"cancelled": true}),
        });
    }
    ctx.files.delete_project(&project.id)?;
    Ok(Outcome {
        changed: true,
        human: format!("Deleted project \"{}\".\n", project.name),
        json: json!({"deleted": project}),
    })
}
