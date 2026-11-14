//! Running the agents' own commands (`codex`, `claude`). They are found on
//! `PATH` without a shell, run with no input and a time limit, and their
//! output is captured. Tests put fake commands first on `PATH`, so no test
//! reaches a real agent or the network.

use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How long one agent command may take. Adding a marketplace clones it.
const TIMEOUT: Duration = Duration::from_secs(300);

/// What a finished command printed.
#[derive(Debug, Clone)]
pub struct CliOutput {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

impl CliOutput {
    /// The reason to show when the command failed: its last lines of output.
    pub fn reason(&self) -> String {
        let text = if self.stderr.trim().is_empty() {
            &self.stdout
        } else {
            &self.stderr
        };
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        let tail = &lines[lines.len().saturating_sub(3)..];
        if tail.is_empty() {
            "it failed without a message".to_string()
        } else {
            tail.join(" ")
        }
    }
}

/// The first executable regular file called `name` in the absolute `PATH`
/// folders.
pub fn find_on_path(name: &str, path_var: Option<&OsStr>) -> Option<PathBuf> {
    let path_var = path_var?;
    std::env::split_paths(path_var)
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join(name))
        .find(|candidate| is_executable(candidate))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

/// Runs `program args…` in `cwd` and waits for it. `Err` means it could not
/// be started or did not finish in time.
pub fn run(program: &Path, args: &[&str], cwd: Option<&Path>) -> Result<CliOutput, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let shown = display(program, args);
    let mut child = command
        .spawn()
        .map_err(|error| format!("{shown} could not be started: {error}"))?;
    let stdout = reader(child.stdout.take());
    let stderr = reader(child.stderr.take());
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < TIMEOUT => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{shown} did not finish within {} seconds",
                    TIMEOUT.as_secs()
                ));
            }
        }
    };
    Ok(CliOutput {
        ok: status.success(),
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

/// The command as a person would type it, for messages.
pub fn display(program: &Path, args: &[&str]) -> String {
    let name = program
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    std::iter::once(name.as_str())
        .chain(args.iter().copied())
        .collect::<Vec<_>>()
        .join(" ")
}

fn reader(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes);
        }
        String::from_utf8_lossy(&bytes).into_owned()
    })
}
