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
    run_with_timeout(program, args, cwd, TIMEOUT)
}

/// [`run`] with its own time limit, for callers that must answer quickly.
pub fn run_with_timeout(
    program: &Path,
    args: &[&str],
    cwd: Option<&Path>,
    limit: Duration,
) -> Result<CliOutput, String> {
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
    let started = Instant::now();
    let stdout = reader(child.stdout.take());
    let stderr = reader(child.stderr.take());
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < limit => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{shown} did not finish within {} seconds",
                    limit.as_secs().max(1)
                ));
            }
        }
    };
    // A command it started can keep a pipe open after it exited, so the output is collected
    // within what is left of the same limit too. The wording keeps "did not finish", which
    // callers read as a timeout rather than as the command's own answer.
    let left = || limit.saturating_sub(started.elapsed());
    let stdout = stdout.collect(left());
    let stderr = stdout.as_ref().and_then(|_| stderr.collect(left()));
    let (Some(stdout), Some(stderr)) = (stdout, stderr) else {
        return Err(format!(
            "{shown} did not finish within {} seconds: a process it started kept its output open",
            limit.as_secs().max(1)
        ));
    };
    Ok(CliOutput {
        ok: status.success(),
        stdout,
        stderr,
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

/// The output of one pipe, read on its own thread until the pipe closes.
struct Reader(std::sync::mpsc::Receiver<String>);

impl Reader {
    /// The text once the pipe closed, or `None` when it is still open after `limit`. The thread
    /// is left to end by itself then.
    fn collect(&self, limit: Duration) -> Option<String> {
        self.0.recv_timeout(limit).ok()
    }
}

fn reader(pipe: Option<impl Read + Send + 'static>) -> Reader {
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes);
        }
        let _ = sender.send(String::from_utf8_lossy(&bytes).into_owned());
    });
    Reader(receiver)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn script(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("fake");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .unwrap();
        path
    }

    #[test]
    fn output_is_captured_when_the_command_finishes() {
        let dir = tempfile::tempdir().unwrap();
        let program = script(dir.path(), "echo out; echo err >&2");
        let output = run_with_timeout(&program, &[], None, Duration::from_secs(30)).unwrap();
        assert!(output.ok);
        assert_eq!(output.stdout.trim(), "out");
        assert_eq!(output.stderr.trim(), "err");
    }

    #[test]
    fn a_process_left_holding_the_output_cannot_outlast_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        // The command exits at once, but a background process keeps its output open.
        let program = script(dir.path(), "sleep 20 &\nexit 0");
        let started = Instant::now();
        let error = run_with_timeout(&program, &[], None, Duration::from_secs(1)).unwrap_err();
        assert!(error.contains("did not finish"), "{error}");
        assert!(error.contains("kept its output open"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
