//! The supervisor thread: it starts due restarts, ends a child that never starts, and launches
//! the sessions whose auto-start is saved when the server starts.

use std::path::PathBuf;
use std::sync::{Arc, Weak};
use std::time::Instant;

use super::Launched;
use super::Launcher;
use super::spawn::Spawn;
use super::supervisor::{PlanState, retryable, span};
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::server::sessions::Tool;

/// The name of the project and the first of its bound folders that still exists.
pub fn resolve_project(
    files: &FileStore,
    project: &ProjectId,
) -> Result<(String, PathBuf), AgboardError> {
    let catalog = files.catalog()?;
    let meta = catalog
        .projects
        .iter()
        .find(|meta| meta.id == *project)
        .ok_or_else(|| AgboardError::ProjectNotFound {
            project: project.to_string(),
        })?;
    let folder = files
        .bindings()?
        .into_iter()
        .filter(|binding| binding.project_id == *project)
        .map(|binding| binding.folder)
        .find(|folder| folder.is_dir())
        .ok_or_else(|| AgboardError::ProjectHasNoFolder {
            project: meta.name.clone(),
        })?;
    Ok((meta.name.clone(), folder))
}

impl Launcher {
    /// Start the supervisor thread, and launch the sessions whose auto-start is saved. `resolve`
    /// names the project and a folder of it. Nothing here can stop the server: a start that
    /// fails shows as `failed` (or `restarting`) in [`Launcher::health`].
    pub fn start<R>(self: &Arc<Self>, resolve: R)
    where
        R: Fn(&ProjectId) -> Result<(String, PathBuf), AgboardError> + Send + 'static,
    {
        let weak: Weak<Launcher> = Arc::downgrade(self);
        let tick = self.timing.tick;
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(tick);
                let Some(launcher) = weak.upgrade() else {
                    return;
                };
                if launcher.is_closing() {
                    return;
                }
                launcher.tick();
            }
        });
        let launcher = self.clone();
        std::thread::spawn(move || {
            if let Some(choice) = launcher.autostart.get() {
                let tool = choice.tool;
                let project = choice.project_id.clone();
                let (name, folder) = match resolve(&project) {
                    Ok(found) => found,
                    Err(error) => {
                        let none = std::path::Path::new("");
                        launcher.start_failed(tool, &project, &choice, "", none, &error);
                        return;
                    }
                };
                if let Err(error) =
                    launcher.launch(&project, &name, &folder, tool, choice.model.as_deref())
                {
                    launcher.start_failed(tool, &project, &choice, &name, &folder, &error);
                }
            }
        });
    }

    fn tick(self: &Arc<Self>) {
        let now = Instant::now();
        let mut unhealthy = Vec::new();
        let mut due = Vec::new();
        {
            let mut plans = self.plans();
            for (tool, plan) in plans.iter_mut() {
                match plan.state {
                    PlanState::Running => {
                        // Once a child has attached (its driver reported an event), only its
                        // exit ends it: a turn on a task can take far longer than any limit.
                        if plan.attached.is_none()
                            && now.saturating_duration_since(plan.started)
                                > self.timing.startup_allowance
                        {
                            plan.kill_reason = Some(format!(
                                "The {} session never started for {}, so the board ended it.",
                                tool.as_str(),
                                span(self.timing.startup_allowance)
                            ));
                            unhealthy.push(*tool);
                        }
                    }
                    PlanState::Restarting { due: at, .. } if now >= at => due.push(*tool),
                    _ => {}
                }
            }
        }
        for tool in unhealthy {
            self.kill(tool);
        }
        for tool in due {
            self.relaunch(tool);
        }
    }

    fn relaunch(self: &Arc<Self>, tool: Tool) {
        let target = {
            let plans = self.plans();
            plans
                .get(&tool)
                .filter(|plan| matches!(plan.state, PlanState::Restarting { .. }))
                .map(|plan| {
                    (
                        plan.project.clone(),
                        plan.project_name.clone(),
                        plan.folder.clone(),
                        plan.model.clone(),
                    )
                })
        };
        let Some((project, name, folder, model)) = target else {
            return;
        };
        let result: Result<Launched, AgboardError> = self.spawn_child(
            &project,
            &name,
            &folder,
            tool,
            model.as_deref(),
            Spawn::Relaunch,
        );
        if let Err(error) = result {
            let mut plans = self.plans();
            if let Some(plan) = plans
                .get_mut(&tool)
                .filter(|plan| matches!(plan.state, PlanState::Restarting { .. }))
            {
                plan.fail(&self.timing, error.reason(), retryable(&error));
            }
        }
    }
}
