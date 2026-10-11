//! The `agboard` command line interface.

pub mod args;
pub mod commands;
pub mod errors;
pub mod output;
pub mod run;

use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::clock::{Clock, SystemClock};
use crate::domain::{ProjectId, ProjectMeta};
use crate::error::AgboardError;
use crate::file_store::FileStore;

/// The project a command was told to work on, resolved once from `--project`
/// before the command runs. The ID, not the name, is used from then on, so a
/// rename, a deletion or a same-name re-creation in the meantime can never
/// redirect the command to another project.
#[derive(Debug, Clone)]
pub enum Target {
    /// The project exists; its ID is fixed for this run.
    Existing(ProjectMeta),
    /// No project has this name. Only `init` may create it.
    Missing { name: String },
    /// The command works on the catalog of projects and names none
    /// (`project create`, `project ls`, `serve`).
    Catalog,
}

/// Everything a command runs with.
pub struct Context {
    /// The shared files: the canonical store of every project.
    pub files: FileStore,
    pub target: Target,
    pub clock: Box<dyn Clock>,
    pub json: bool,
    /// Whether a human can be asked to confirm. Always `false` for now.
    pub interactive: bool,
}

impl Context {
    /// The resolved project. A project that does not exist is
    /// `project_not_found`; a catalog-wide command has none. Nothing is
    /// substituted.
    pub fn project(&self) -> Result<&ProjectMeta, AgboardError> {
        match &self.target {
            Target::Existing(meta) => Ok(meta),
            Target::Missing { name } => Err(AgboardError::ProjectNotFound {
                project: name.clone(),
            }),
            Target::Catalog => Err(AgboardError::InvalidArgument {
                message: "--project NAME is required.".to_string(),
                command: None,
            }),
        }
    }

    /// The resolved project's ID. Fixed for this run.
    pub fn project_id(&self) -> Result<&ProjectId, AgboardError> {
        self.project().map(|meta| &meta.id)
    }
}

/// What a command did.
pub struct Outcome {
    pub changed: bool,
    /// Text for a human; ends with a newline.
    pub human: String,
    pub json: serde_json::Value,
}

/// The outside world of one run: where the board is, the time, and where the
/// output goes. Tests supply their own.
pub struct Env<'a> {
    pub clock: Box<dyn Clock>,
    /// The shared folder: the canonical files of every project.
    pub shared_dir: PathBuf,
    pub stdout: &'a mut dyn Write,
    pub stderr: &'a mut dyn Write,
    /// Called once after a command that changed the stored data, with the
    /// data directory (the parent of the shared folder). A running `serve` is
    /// found through the `serve.json` in that same directory.
    pub after_commit: &'a mut dyn FnMut(&Context, &Path),
}

/// Entry point of the command line interface. Returns the process exit code.
pub fn run() -> i32 {
    let args: Vec<OsString> = std::env::args_os().collect();
    let mut stdout = std::io::stdout().lock();
    let mut stderr = std::io::stderr().lock();
    let mut after_commit = |ctx: &Context, dir: &Path| run::after_commit(ctx, dir);
    let mut env = Env {
        clock: Box::new(SystemClock),
        shared_dir: crate::paths::shared_dir(),
        stdout: &mut stdout,
        stderr: &mut stderr,
        after_commit: &mut after_commit,
    };
    run_with(&args, &mut env)
}

/// Like [`run`], but with the arguments and environment given.
pub fn run_with(args: &[OsString], env: &mut Env) -> i32 {
    run::execute(args, env)
}
