//! Finding the agents connect can configure: `claude` and `codex` on PATH,
//! and the version each one reports. The PATH is searched directly, with no
//! shell and no expansion, and the version command runs with a time limit and
//! no input. That an agent is found says nothing about whether it is running
//! or has loaded anything.

use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::types::Agent;

/// How long `--version` may take.
const VERSION_TIMEOUT: Duration = Duration::from_secs(3);

/// An agent found on PATH.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub path: PathBuf,
    /// The first line the agent printed for `--version`, if it answered in time.
    pub version: Option<String>,
}

/// The result of looking for one agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Detection {
    pub agent: Agent,
    /// `Err` holds the reason the agent cannot be selected.
    pub found: Result<Found, String>,
}

impl Detection {
    pub fn is_available(&self) -> bool {
        self.found.is_ok()
    }
}

/// The executable name of an agent.
pub fn binary_name(agent: Agent) -> &'static str {
    agent.key()
}

/// Looks for every supported agent, in the order connect offers them.
pub fn detect_all(path_var: Option<&OsStr>) -> Vec<Detection> {
    Agent::ALL
        .iter()
        .map(|&agent| Detection {
            agent,
            found: detect(agent, path_var),
        })
        .collect()
}

fn detect(agent: Agent, path_var: Option<&OsStr>) -> Result<Found, String> {
    let name = binary_name(agent);
    let Some(path) = find_on_path(name, path_var) else {
        return Err(format!("`{name}` was not found on PATH."));
    };
    let version = read_version(&path);
    Ok(Found { path, version })
}

/// The first executable regular file called `name` in the PATH directories.
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

/// Runs `<path> --version` and returns its first output line. `None` when it
/// fails, prints nothing, or does not finish within the time limit.
pub fn read_version(path: &Path) -> Option<String> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.by_ref().take(4096).read_to_string(&mut text);
        text
    });
    let started = Instant::now();
    let finished = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if started.elapsed() < VERSION_TIMEOUT => {
                std::thread::sleep(Duration::from_millis(10));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    let text = reader.join().ok()?;
    if !finished {
        return None;
    }
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(80).collect())
}
