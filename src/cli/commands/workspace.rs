//! `agboard --project NAME workspace`: where a project's shared files are.
//! Read-only; it names absolute paths so an agent can open the files directly.

use serde_json::json;

use crate::cli::{Context, Outcome};
use crate::error::AgboardError;
use crate::file_store::layout;

pub fn run(ctx: &Context) -> Result<Outcome, AgboardError> {
    let project = ctx.project()?;
    let folder = layout::project_dir(ctx.files.shared_dir(), &project.id);
    let folder = std::path::absolute(&folder).unwrap_or(folder);
    let readme = layout::readme_file(&folder);
    let tasks = layout::tasks_dir(&folder);
    let epics = layout::epics_dir(&folder);
    let human = format!(
        "Project: {}\nProject ID: {}\nFolder: {}\nREADME: {}\nTasks: {}\nEpics: {}\n",
        project.name,
        project.id,
        folder.display(),
        readme.display(),
        tasks.display(),
        epics.display(),
    );
    Ok(Outcome {
        changed: false,
        human,
        json: json!({
            "projectId": project.id,
            "folder": folder,
            "readme": readme,
            "tasks": tasks,
            "epics": epics,
        }),
    })
}
