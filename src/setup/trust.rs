//! Trusting the plugin's hooks in Codex. Codex runs a plugin's hook only after
//! the user trusts it, and the trust is tied to the plugin's content, so every
//! install or update needs it again. With the user's consent on the
//! confirmation screen, agboard writes the trust through Codex's own
//! app-server: `hooks/list` gives each hook's current hash and
//! `config/value/write` stores it under `hooks.state`. Only the Agent Board
//! plugin's hooks are touched.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

use serde_json::{Map, Value, json};

use super::plugin::PLUGIN_ID;

/// How long the whole exchange with the app-server may take.
const TIMEOUT: Duration = Duration::from_secs(60);

/// Trusts every Agent Board hook that Codex does not trust yet. Returns how
/// many hooks were trusted now (0 when all were trusted already).
pub fn trust_codex_hooks(program: &Path, cwd: &Path) -> Result<usize, String> {
    let mut server = Server::start(program, cwd)?;
    let result = exchange(&mut server, cwd);
    server.stop();
    result
}

fn exchange(server: &mut Server, cwd: &Path) -> Result<usize, String> {
    server.request(
        0,
        "initialize",
        json!({"clientInfo": {"name": "agboard", "version": env!("CARGO_PKG_VERSION")}}),
    )?;
    server.notify("initialized")?;
    let hooks = list(server, 1, cwd)?;
    if hooks.is_empty() {
        return Err(
            "Codex lists no hooks of the Agent Board plugin, so nothing was trusted. Check that the plugin is installed and enabled with `codex plugin list`."
                .to_string(),
        );
    }
    let mut value = Map::new();
    for hook in hooks.iter().filter(|hook| !hook.trusted) {
        value.insert(hook.key.clone(), json!({"trusted_hash": hook.hash}));
    }
    if value.is_empty() {
        return Ok(0);
    }
    let count = value.len();
    server.request(
        2,
        "config/value/write",
        json!({"keyPath": "hooks.state", "mergeStrategy": "upsert", "value": value}),
    )?;
    let after = list(server, 3, cwd)?;
    if let Some(hook) = after.iter().find(|hook| !hook.trusted) {
        return Err(format!(
            "Codex still does not trust the hook {} after the trust was written. Review it in Codex with /hooks.",
            hook.key
        ));
    }
    Ok(count)
}

struct Hook {
    key: String,
    hash: String,
    trusted: bool,
}

fn list(server: &mut Server, id: u64, cwd: &Path) -> Result<Vec<Hook>, String> {
    let result = server.request(
        id,
        "hooks/list",
        json!({"cwds": [cwd.display().to_string()]}),
    )?;
    let mut hooks = Vec::new();
    let entries = result.get("data").and_then(Value::as_array);
    for hook in entries
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("hooks").and_then(Value::as_array))
        .flatten()
    {
        if hook.get("pluginId").and_then(Value::as_str) != Some(PLUGIN_ID) {
            continue;
        }
        let text = |name: &str| hook.get(name).and_then(Value::as_str).map(str::to_string);
        let (Some(key), Some(hash)) = (text("key"), text("currentHash")) else {
            return Err("Codex listed a hook without its key or hash.".to_string());
        };
        let trusted = text("trustStatus").as_deref() == Some("trusted");
        hooks.push(Hook { key, hash, trusted });
    }
    Ok(hooks)
}

/// A running `codex app-server`, spoken to in JSON lines.
struct Server {
    child: Child,
    input: Option<ChildStdin>,
    lines: Receiver<String>,
    deadline: Instant,
}

impl Server {
    fn start(program: &Path, cwd: &Path) -> Result<Server, String> {
        let mut child = Command::new(program)
            .arg("app-server")
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("codex app-server could not be started: {error}"))?;
        let input = child.stdin.take();
        let output = child.stdout.take();
        let (send, lines) = mpsc::channel();
        std::thread::spawn(move || {
            let Some(output) = output else { return };
            for line in BufReader::new(output).lines().map_while(Result::ok) {
                if send.send(line).is_err() {
                    break;
                }
            }
        });
        Ok(Server {
            child,
            input,
            lines,
            deadline: Instant::now() + TIMEOUT,
        })
    }

    fn send(&mut self, message: &Value) -> Result<(), String> {
        let input = self
            .input
            .as_mut()
            .ok_or("codex app-server closed its input")?;
        writeln!(input, "{message}")
            .and_then(|()| input.flush())
            .map_err(|error| format!("codex app-server stopped reading: {error}"))
    }

    fn notify(&mut self, method: &str) -> Result<(), String> {
        self.send(&json!({"method": method}))
    }

    /// Sends a request and waits for the answer with the same id.
    fn request(&mut self, id: u64, method: &str, params: Value) -> Result<Value, String> {
        self.send(&json!({"id": id, "method": method, "params": params}))?;
        loop {
            let left = self.deadline.saturating_duration_since(Instant::now());
            let line = self.lines.recv_timeout(left).map_err(|_| {
                format!("codex app-server did not answer {method} in time, or stopped")
            })?;
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if message.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = message.get("error") {
                return Err(format!("codex app-server refused {method}: {error}"));
            }
            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    fn stop(mut self) {
        drop(self.input.take());
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
