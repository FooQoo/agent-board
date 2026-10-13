//! `agboard project create|ls|rename|rm`: managing the projects themselves.
//!
//! `create` and `ls` work on the catalog and name no project. `rename` and
//! `rm` act on the one project resolved from `--project` before the command
//! ran; they use its ID from then on, so a deletion, a rename or a same-name
//! re-creation in the meantime can never redirect them to another project.

use std::io::{BufRead, Write};

use serde_json::json;

use std::path::{Path, PathBuf};

use crate::cli::args::{
    ProjectArgs, ProjectBindArgs, ProjectCommand, ProjectCreateArgs, ProjectRenameArgs,
};
use crate::cli::{Context, Outcome};
use crate::domain::validate_project_name;
use crate::error::AgboardError;
use crate::file_store::bindings::canonical_folder;
use crate::interact::confirm;

pub fn run(ctx: &mut Context, args: &ProjectArgs) -> Result<Outcome, AgboardError> {
    match &args.command {
        ProjectCommand::Create(args) => create(ctx, args),
        ProjectCommand::Bind(args) => bind(ctx, args),
        ProjectCommand::Ls => ls(ctx),
        ProjectCommand::Rename(args) => rename(ctx, args),
        ProjectCommand::Rm => rm(ctx),
    }
}

/// Create an empty project bound to a folder: `--folder`, or the current
/// folder. A name already in use is `project_name_exists`; a folder that
/// belongs to another project is refused before anything is created. If the
/// binding still fails, the new project is removed again.
pub fn create(ctx: &Context, args: &ProjectCreateArgs) -> Result<Outcome, AgboardError> {
    let folder = folder_or_current(args.folder.as_deref())?;
    if ctx.files.live_binding_for_folder(&folder)?.is_some() {
        return Err(AgboardError::FolderBoundElsewhere {
            folder: folder.display().to_string(),
        });
    }
    let project = ctx.files.create_project(&args.name, ctx.clock.now())?;
    if let Err(error) = ctx.files.bind_folder(&project.id, &folder) {
        let _ = ctx.files.delete_project(&project.id);
        return Err(error);
    }
    Ok(Outcome {
        changed: true,
        human: format!(
            "Created project \"{}\" and bound it to this folder.\n",
            project.name
        ),
        json: json!({"project": project}),
    })
}

/// Bind an existing project to a folder: `--folder`, or the current folder.
/// Binding a folder to its own project again changes nothing.
pub fn bind(ctx: &Context, args: &ProjectBindArgs) -> Result<Outcome, AgboardError> {
    let name = validate_project_name(&args.name)?;
    let project = ctx.files.project_by_name(&name)?;
    let folder = folder_or_current(args.folder.as_deref())?;
    let bound = ctx.files.bind_folder(&project.id, &folder)?;
    let human = if bound.changed {
        format!("Bound project \"{}\" to this folder.\n", project.name)
    } else {
        format!(
            "Project \"{}\" is already bound to this folder. Nothing was changed.\n",
            project.name
        )
    };
    Ok(Outcome {
        changed: bound.changed,
        human,
        json: json!({"project": project, "bound": bound.changed}),
    })
}

/// The given folder, or the current one, checked and made canonical.
fn folder_or_current(folder: Option<&Path>) -> Result<PathBuf, AgboardError> {
    let path = match folder {
        Some(path) => path.to_path_buf(),
        None => std::env::current_dir().map_err(|_| AgboardError::InvalidValue {
            field: "--folder".to_string(),
            reason: "Use an existing folder.".to_string(),
        })?,
    };
    canonical_folder(&path)
}

/// The projects by name, with the catalog revision.
pub fn ls(ctx: &Context) -> Result<Outcome, AgboardError> {
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
pub fn rename(ctx: &Context, args: &ProjectRenameArgs) -> Result<Outcome, AgboardError> {
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

pub fn rm(ctx: &mut Context) -> Result<Outcome, AgboardError> {
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
) -> Result<Outcome, AgboardError> {
    let project = ctx.project()?;
    if ctx.json || !ctx.interactive {
        return Err(AgboardError::ConfirmationRequired {
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
