//! The automatic plugin update done from the SessionStart hook.
//!
//! The binary embeds a content hash of the plugin it ships (`plugin_hash`).
//! At session start the hook hashes the same files of the plugin the agent
//! runs (found through the plugin root variable the agent sets) and, when the
//! hashes differ, starts `agboard update --agent <agent> --yes --background`
//! as a detached process, so the hook returns within its time limit.
//!
//! The background run takes a lock in the data area, so concurrent sessions
//! reinstall once, and records its attempt, so a failing update is not
//! retried on every session. It reinstalls the plugin like `agboard update`
//! but never trusts Codex hooks: that stays a decision of the user.

use std::io;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use super::{Agent, Mode, SetupEnv, SetupOptions, SetupReport, Status};

mod state;
pub use state::{Attempt, Files, Lock};

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/plugin_files.rs"));
}
pub use embedded::{PLUGIN_FILES, PLUGIN_HASH};

/// Set to anything but `0` or empty to turn the automatic update off.
pub const OPT_OUT: &str = "AGBOARD_NO_PLUGIN_AUTO_UPDATE";

/// How long a failed (or unfinished) attempt is not repeated.
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(6 * 60 * 60);
/// How long a finished attempt that still left a different plugin (a build
/// made from a checkout, say) is not repeated.
const RETRY_AFTER_SUCCESS: Duration = Duration::from_secs(24 * 60 * 60);

/// Whether the user turned the automatic update off.
pub fn opted_out() -> bool {
    std::env::var_os(OPT_OUT).is_some_and(|value| !value.is_empty() && value != "0")
}

/// The folder of the plugin the agent runs the hook from.
pub fn plugin_root(agent: Agent) -> Option<PathBuf> {
    let from = |name: &str| {
        std::env::var_os(name)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    };
    match agent {
        Agent::Claude => from("CLAUDE_PLUGIN_ROOT"),
        Agent::Codex => from("PLUGIN_ROOT").or_else(|| from("CLAUDE_PLUGIN_ROOT")),
    }
}

/// Whether the plugin in `root` has the files this agboard ships. A missing
/// or unreadable file does not match.
pub fn installed_matches(root: &Path) -> bool {
    crate::plugin_hash::hash_files(root, PLUGIN_FILES).as_deref() == Some(PLUGIN_HASH)
}

/// Whether `root` is a copy an agent installed from a marketplace (inside a
/// `plugins/cache` folder of the agent), not a checkout or a `--plugin-dir`.
/// The layout is the one Claude Code and Codex use for installed plugins.
pub fn installed_from_marketplace(root: &Path) -> bool {
    let parts: Vec<_> = root.components().map(|c| c.as_os_str()).collect();
    parts
        .windows(2)
        .any(|w| w[0] == "plugins" && w[1] == "cache")
}

/// The Codex hook definition this agboard ships.
const SHIPPED_CODEX_HOOKS: &str = include_str!("../../plugins/agent-board/hooks/codex.json");

/// Whether the Codex hook definition in `root` differs from the shipped one.
/// Codex keys its trust on the definition, so only then must the user trust
/// the hooks again.
fn codex_hooks_changed(root: &Path) -> bool {
    std::fs::read_to_string(root.join("hooks/codex.json"))
        .ok()
        .as_deref()
        != Some(SHIPPED_CODEX_HOOKS)
}

/// What the hook should tell the agent at session start, after starting an
/// update when one is due. Reads a few small files and starts at most one
/// detached process; it never waits for it.
pub fn session_start_notice(agent: Agent, data_dir: &Path) -> Option<String> {
    if opted_out() {
        return None;
    }
    let root = plugin_root(agent)?;
    if !root.is_dir() || !installed_from_marketplace(&root) || installed_matches(&root) {
        return None;
    }
    let files = Files::new(data_dir, agent);
    if files.lock_held() {
        // Another session is updating it.
        return None;
    }
    if let Some(attempt) = files.last_attempt()
        && attempt.hash == PLUGIN_HASH
        && attempt.age() < retry_wait(attempt.ok)
    {
        // Not tried again yet. A failure is worth telling the user about; a
        // finished attempt that left another plugin (a build from a checkout)
        // is not.
        return if attempt.ok {
            None
        } else {
            Some(failed_notice())
        };
    }
    start(agent, &root)
}

fn retry_wait(ok: bool) -> Duration {
    if ok {
        RETRY_AFTER_SUCCESS
    } else {
        RETRY_AFTER_FAILURE
    }
}

fn start(agent: Agent, root: &Path) -> Option<String> {
    let hooks_changed = agent == Agent::Codex && codex_hooks_changed(root);
    spawn_background(agent).ok()?;
    Some(started_notice(agent, hooks_changed))
}

fn started_notice(agent: Agent, hooks_changed: bool) -> String {
    let version = super::VERSION;
    let mut text = format!(
        "AGBOARD_NOTICE\nThe Agent Board plugin differs from the one this agboard (version {version}) ships. agboard started updating it to version {version} in the background; the update applies from the next session, and nothing needs to be done now."
    );
    if agent == Agent::Codex && hooks_changed {
        text.push_str(" The hook definition changed, and Codex runs a plugin's hooks only after they are trusted. agboard never trusts them by itself: once the update has finished, tell the user to run `agboard update` in a terminal, then start a new session.");
    }
    text
}

fn failed_notice() -> String {
    "AGBOARD_NOTICE\nThe automatic update of the Agent Board plugin did not complete. Tell the user to run `agboard update` in a terminal, then start a new session. Setting AGBOARD_NO_PLUGIN_AUTO_UPDATE=1 turns the automatic update off.".to_string()
}

/// Starts the background update as a process of its own, so it outlives the
/// hook and is not stopped with it.
fn spawn_background(agent: Agent) -> io::Result<()> {
    let exe = std::env::current_exe()?;
    let mut command = Command::new(exe);
    command
        .args(["update", "--agent", agent.key(), "--yes", "--background"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // SAFETY: setsid is async-signal-safe; it detaches the child from the
    // hook's process group and terminal.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    command.spawn().map(|_| ())
}

/// How long the tag check may take.
const TAG_CHECK_TIMEOUT: Duration = Duration::from_secs(15);

/// Whether the release tag of this version is confirmed to exist on the
/// remote: `git ls-remote --exit-code --tags <repo> refs/tags/<tag>` exits 0
/// only when the tag is there (2 when absent, 128 on a network error). Without
/// `git`, on a failure, or after [`TAG_CHECK_TIMEOUT`] the answer is no: a
/// marketplace that cannot be added again must never be removed. A source
/// without a tag (the marketplace override) needs no check.
pub fn release_tag_confirmed(
    source: &super::plugin::Source,
    path_var: Option<&std::ffi::OsStr>,
) -> bool {
    let Some(reference) = &source.reference else {
        return true;
    };
    let Some(git) = super::agent_cli::find_on_path("git", path_var) else {
        return false;
    };
    let child = Command::new(git)
        .args(["ls-remote", "--exit-code", "--tags", &source.location])
        .arg(format!("refs/tags/{reference}"))
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = child else {
        return false;
    };
    let deadline = std::time::Instant::now() + TAG_CHECK_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

/// The body of `agboard update --agent <agent> --yes --background`: the
/// reinstall of `agboard update`, without a question and without trusting
/// Codex hooks. Does nothing when another update holds the lock. `None` when
/// nothing was done.
pub fn run_background(env: &SetupEnv, agent: Agent) -> Option<SetupReport> {
    if opted_out() {
        return None;
    }
    let files = Files::new(&env.data_dir().ok()?, agent);
    let _lock = files.acquire()?;
    // Recorded first, so a run that never finishes is not retried at once.
    files.record(false);
    let options = SetupOptions {
        mode: Mode::Update,
        agents: vec![agent],
        dry_run: false,
    };
    // First of all, before any agent command: the tag must exist.
    let source = super::plugin::Source::for_version(super::VERSION, env.marketplace_override());
    if !release_tag_confirmed(&source, env.path_var.as_deref()) {
        return None;
    }
    let mut prepared = super::prepare(env, &options).ok()?;
    for plan in &mut prepared.agents {
        plan.trust = false;
    }
    let report = super::execute(prepared).ok()?;
    files.record(report.agents.iter().all(|a| a.status != Status::Failed));
    Some(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_embedded_hash_matches_the_plugin_folder() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("plugins/agent-board");
        assert!(installed_matches(&root));
        assert!(PLUGIN_FILES.contains(&"hooks/claude.json"));
    }
}
