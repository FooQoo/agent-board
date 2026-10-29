//! Checks on the combination of arguments, done before any board access.

use super::{
    AttachmentArgs, AttachmentCommand, Cli, Command, EpicArgs, EpicCommand, ProjectArgs,
    ProjectCommand, ServeArgs, WaitUntilArg,
};
use crate::error::AgboardError;

impl Cli {
    /// Checks that depend on the combination of arguments, done before any
    /// board access so that a wrong command line always exits with 2.
    pub fn validate(&self) -> Result<(), AgboardError> {
        let command = self.command.name();
        match (&self.command, self.project()) {
            // The read-only list of every project names no single project.
            (Command::Ls(args), Some(_)) if args.all_projects => {
                return Err(AgboardError::InvalidArgument {
                    message: "ls --all-projects does not take --project.".to_string(),
                    command: Some(command.to_string()),
                });
            }
            (Command::Ls(args), None) if args.all_projects => {}
            // `serve` shows every project, so naming one is a mistake.
            (
                Command::Serve(_)
                | Command::Stop(_)
                | Command::Setup(_)
                | Command::Connect(_)
                | Command::Update(_),
                Some(_),
            ) => {
                return Err(AgboardError::InvalidArgument {
                    message: format!("{command} does not take --project."),
                    command: Some(command.to_string()),
                });
            }
            (Command::Update(_), None) if self.json => {
                return Err(AgboardError::InvalidArgument {
                    message: "update does not take --json or --dry-run.".to_string(),
                    command: Some(command.to_string()),
                });
            }
            (Command::Connect(_), None) if self.json => {
                return Err(AgboardError::InvalidArgument {
                    message: "connect is interactive and does not take --json.".to_string(),
                    command: Some(command.to_string()),
                });
            }
            // The hook reports a missing project itself, as a hook error that
            // does not block the agent's tool result.
            // Creating and listing projects name no project either.
            (
                Command::Project(ProjectArgs {
                    command:
                        ProjectCommand::Create(_) | ProjectCommand::Bind(_) | ProjectCommand::Ls,
                }),
                Some(_),
            ) => {
                return Err(AgboardError::InvalidArgument {
                    message: format!(
                        "project {} does not take --project.",
                        self.project_subcommand_name()
                    ),
                    command: Some(command.to_string()),
                });
            }
            (
                Command::Project(ProjectArgs {
                    command:
                        ProjectCommand::Create(_) | ProjectCommand::Bind(_) | ProjectCommand::Ls,
                }),
                None,
            ) => {}
            (
                Command::Serve(_)
                | Command::Stop(_)
                | Command::Setup(_)
                | Command::Connect(_)
                | Command::Update(_)
                | Command::Hook(_)
                | Command::Progress(_),
                None,
            ) => {}
            (_, None) => {
                return Err(AgboardError::InvalidArgument {
                    message: "--project NAME is required.".to_string(),
                    command: Some(command.to_string()),
                });
            }
            (_, Some(_)) => {}
        }
        match &self.command {
            Command::Edit(args)
                if args.title.is_none()
                    && args.description.desc.is_none()
                    && args.description.desc_file.is_none()
                    && args.epic.is_none()
                    && !args.clear_epic =>
            {
                Err(AgboardError::InvalidArgument {
                    message: "nothing to change; give --title, --desc, --desc-file, --epic, or --clear-epic.".to_string(),
                    command: Some("edit".to_string()),
                })
            }
            Command::Epic(EpicArgs {
                command: EpicCommand::Edit(args),
            }) if args.name.is_none()
                && args.color.is_none()
                && args.priority.is_none()
                && args.document.document.is_none()
                && args.document.document_file.is_none() =>
            {
                Err(AgboardError::InvalidArgument {
                    message: "nothing to change; give --name, --color, --priority, --document, or --document-file.".to_string(),
                    command: Some("epic edit".to_string()),
                })
            }
            Command::Snapshot(_) if !self.json => Err(AgboardError::InvalidArgument {
                message: "snapshot requires --json.".into(),
                command: Some("snapshot".into()),
            }),
            Command::Attachment(AttachmentArgs {
                command: AttachmentCommand::Get(args),
            }) if args.output.as_os_str().is_empty() => Err(AgboardError::InvalidArgument {
                message: "--output PATH is required.".into(),
                command: Some("attachment get".into()),
            }),
            Command::Serve(args) => {
                validate_monitor_args(args, &|name| std::env::var(name).ok()).map(|_| ())
            }
            Command::Wait(args) if args.until.is_none() && args.after.is_none() => {
                Err(AgboardError::InvalidArgument {
                    message: "wait requires --after CURSOR or --until task --idle-timeout SECONDS.".into(),
                    command: Some("wait".into()),
                })
            }
            Command::Wait(args)
                if args.until == Some(WaitUntilArg::Task) && args.idle_timeout.is_none() =>
            {
                Err(AgboardError::InvalidArgument {
                    message: "wait --until task requires --idle-timeout SECONDS.".into(),
                    command: Some("wait".into()),
                })
            }
            Command::Wait(args) if args.until.is_none() && args.idle_timeout.is_some() => {
                Err(AgboardError::InvalidArgument {
                    message: "--idle-timeout is only valid with --until task.".into(),
                    command: Some("wait".into()),
                })
            }
            _ => Ok(()),
        }
    }
}

/// Check the monitor options of `serve`. `env` reads one environment variable.
/// `Ok(false)` means no monitor option was given; `Ok(true)` means `--monitor ngrok`
/// is valid. Every failure is an invalid-argument error (exit code 2) that never
/// repeats a secret value.
pub fn validate_monitor_args(
    args: &ServeArgs,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<bool, AgboardError> {
    let invalid = |message: &str| AgboardError::InvalidArgument {
        message: message.to_string(),
        command: Some("serve".into()),
    };
    match args.monitor.as_deref() {
        None => return Ok(false),
        Some("ngrok") => {}
        Some(_) => return Err(invalid("--monitor accepts only ngrok.")),
    }
    if env("NGROK_AUTHTOKEN").is_none_or(|v| v.is_empty()) {
        return Err(invalid(
            "--monitor ngrok requires NGROK_AUTHTOKEN in the environment.",
        ));
    }
    Ok(true)
}

impl Cli {
    /// The project named with `--project`, if any. Giving the option more than
    /// once is rejected by [`parse`], so there is at most one.
    pub fn project(&self) -> Option<&str> {
        self.project.as_deref()
    }

    fn project_subcommand_name(&self) -> &'static str {
        match &self.command {
            Command::Project(ProjectArgs { command }) => match command {
                ProjectCommand::Create(_) => "create",
                ProjectCommand::Bind(_) => "bind",
                ProjectCommand::Ls => "ls",
                ProjectCommand::Rename(_) => "rename",
                ProjectCommand::Rm => "rm",
            },
            _ => "",
        }
    }
}
