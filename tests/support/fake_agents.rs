//! Fake `codex` and `claude` commands for the setup and update tests. They are
//! small shell scripts put first (and alone) on `PATH`, so no test reaches a
//! real agent, the user's settings, or the network. Each one logs its
//! arguments, answers the plugin commands that setup runs, and keeps what is
//! "installed" in files of a state folder. The fake `codex app-server` answers
//! `hooks/list` and `config/value/write` the way Codex does.

#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

pub const PLUGIN: &str = "agent-board@agent-board";

const SCRIPT: &str = r#"#!/bin/sh
S='@STATE@'
A='@AGENT@'
printf '%s\n' "$*" >> "$S/$A.log"
if [ -f "$S/$A.fail" ]; then
  case "$*" in
    "$(/bin/cat "$S/$A.fail")"*) echo "fake failure: network is unreachable" >&2; exit 1 ;;
  esac
fi
case "$*" in
  "plugin list --json")
    if [ -f "$S/$A.installed" ]; then
      v=$(/bin/cat "$S/$A.installed")
      ip=''
      if [ -f "$S/$A.path" ]; then ip=',"installPath":"'$(/bin/cat "$S/$A.path")'"'; fi
      if [ "$A" = codex ]; then
        printf '{"installed":[{"pluginId":"agent-board@agent-board","version":"%s"%s,"enabled":true}],"available":[]}\n' "$v" "$ip"
      else
        printf '[{"id":"agent-board@agent-board","version":"%s"%s,"scope":"user","enabled":true}]\n' "$v" "$ip"
      fi
    elif [ "$A" = codex ]; then
      echo '{"installed":[],"available":[]}'
    else
      echo '[]'
    fi ;;
  "plugin marketplace add "*)
    all="$*"
    src="${all#plugin marketplace add }"
    if [ -f "$S/$A.market" ] && [ "$(/bin/cat "$S/$A.market")" != "$src" ]; then
      if [ "$A" = codex ]; then
        echo "Error: marketplace 'agent-board' is already added from a different source; remove it before adding this source" >&2
      else
        echo '{"outcome":"failed","failureCode":"declared","error":"source does not match"}'
      fi
      exit 1
    fi
    printf '%s' "$src" > "$S/$A.market"
    echo '{"outcome":"ok"}' ;;
  "plugin marketplace remove agent-board --json")
    /bin/rm -f "$S/$A.market" "$S/$A.installed"
    echo '{}' ;;
  "plugin add agent-board@agent-board --json"|"plugin install agent-board@agent-board --json")
    if [ ! -f "$S/$A.market" ]; then echo "no marketplace" >&2; exit 1; fi
    printf '%s' '@VERSION@' > "$S/$A.installed"
    /bin/rm -f "$S/$A.trusted"
    echo '{}' ;;
  "plugin update agent-board@agent-board --json")
    echo '{}' ;;
  "app-server")
    while IFS= read -r line; do
      id=$(printf '%s' "$line" | /usr/bin/sed -n 's/^{"id":\([0-9]*\),.*/\1/p')
      case "$line" in
        *'"method":"initialize",'*)
          printf '{"id":%s,"result":{"userAgent":"fake"}}\n' "$id" ;;
        *'"method":"hooks/list"'*)
          if [ -f "$S/$A.trusted" ]; then t=trusted; else t=untrusted; fi
          printf '{"method":"note","params":{}}\n'
          printf '{"id":%s,"result":{"data":[{"cwd":"x","hooks":[{"key":"agent-board@agent-board:hooks/codex.json:session_start:0:0","currentHash":"sha256:aaa","trustStatus":"%s","pluginId":"agent-board@agent-board"},{"key":"agent-board@agent-board:hooks/codex.json:post_tool_use:0:0","currentHash":"sha256:bbb","trustStatus":"%s","pluginId":"agent-board@agent-board"},{"key":"other@elsewhere:hooks.json:stop:0:0","currentHash":"sha256:ccc","trustStatus":"untrusted","pluginId":"other@elsewhere"}]}]}}\n' "$id" "$t" "$t" ;;
        *'"method":"config/value/write"'*)
          printf '%s\n' "$line" >> "$S/trust-writes.log"
          : > "$S/$A.trusted"
          printf '{"id":%s,"result":{"status":"ok"}}\n' "$id" ;;
      esac
    done ;;
  *)
    echo "fake: unexpected arguments: $*" >&2
    exit 1 ;;
esac
"#;

/// The fake commands and their state folder.
pub struct FakeAgents {
    pub bin: PathBuf,
    pub state: PathBuf,
}

impl FakeAgents {
    /// Puts fake commands for `agents` ("codex", "claude") in `dir/bin`.
    pub fn new(dir: &Path, agents: &[&str]) -> FakeAgents {
        let bin = dir.join("bin");
        let state = dir.join("fake-state");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&state).unwrap();
        for agent in agents {
            let script = SCRIPT
                .replace("@STATE@", state.to_str().unwrap())
                .replace("@AGENT@", agent)
                .replace("@VERSION@", env!("CARGO_PKG_VERSION"));
            let path = bin.join(agent);
            fs::write(&path, script).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        FakeAgents { bin, state }
    }

    /// The commands `agent` was run with, one line each.
    pub fn log(&self, agent: &str) -> Vec<String> {
        fs::read_to_string(self.state.join(format!("{agent}.log")))
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }

    /// Marks the plugin as installed at `version`, from marketplace `source`.
    pub fn preinstall(&self, agent: &str, version: &str, source: &str) {
        fs::write(self.state.join(format!("{agent}.installed")), version).unwrap();
        fs::write(self.state.join(format!("{agent}.market")), source).unwrap();
    }

    /// Makes `plugin list --json` name the folder the plugin is installed in.
    pub fn install_path(&self, agent: &str, path: &Path) {
        fs::write(
            self.state.join(format!("{agent}.path")),
            path.to_str().unwrap(),
        )
        .unwrap();
    }

    pub fn installed(&self, agent: &str) -> Option<String> {
        fs::read_to_string(self.state.join(format!("{agent}.installed"))).ok()
    }

    pub fn market(&self, agent: &str) -> Option<String> {
        fs::read_to_string(self.state.join(format!("{agent}.market"))).ok()
    }

    /// Makes every command of `agent` that starts with `prefix` fail.
    pub fn fail(&self, agent: &str, prefix: &str) {
        fs::write(self.state.join(format!("{agent}.fail")), prefix).unwrap();
    }

    /// Marks the Codex hooks as trusted already.
    pub fn trust(&self) {
        fs::write(self.state.join("codex.trusted"), "").unwrap();
    }

    /// The `config/value/write` requests the fake app-server received.
    pub fn trust_writes(&self) -> Vec<Value> {
        fs::read_to_string(self.state.join("trust-writes.log"))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}
