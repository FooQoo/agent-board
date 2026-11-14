// Fake `codex` and `claude` commands for the setup specs: the same script as
// `tests/support/fake_agents.rs`. They are put alone on PATH, so no spec reaches a real agent, the
// user's settings, or the network. Each one answers the plugin commands that setup runs and keeps what
// is "installed" in files of a state folder.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SCRIPT = [
	"#!/bin/sh",
	"S='@STATE@'",
	"A='@AGENT@'",
	"printf '%s\\n' \"$*\" >> \"$S/$A.log\"",
	"if [ -f \"$S/$A.fail\" ]; then",
	"  case \"$*\" in",
	"    \"$(/bin/cat \"$S/$A.fail\")\"*) echo \"fake failure: network is unreachable\" >&2; exit 1 ;;",
	"  esac",
	"fi",
	"case \"$*\" in",
	"  \"plugin list --json\")",
	"    if [ -f \"$S/$A.installed\" ]; then",
	"      v=$(/bin/cat \"$S/$A.installed\")",
	"      if [ \"$A\" = codex ]; then",
	"        printf '{\"installed\":[{\"pluginId\":\"agent-board@agent-board\",\"version\":\"%s\",\"enabled\":true}],\"available\":[]}\\n' \"$v\"",
	"      else",
	"        printf '[{\"id\":\"agent-board@agent-board\",\"version\":\"%s\",\"scope\":\"user\",\"enabled\":true}]\\n' \"$v\"",
	"      fi",
	"    elif [ \"$A\" = codex ]; then",
	"      echo '{\"installed\":[],\"available\":[]}'",
	"    else",
	"      echo '[]'",
	"    fi ;;",
	"  \"plugin marketplace add \"*)",
	"    all=\"$*\"",
	"    src=\"${all#plugin marketplace add }\"",
	"    if [ -f \"$S/$A.market\" ] && [ \"$(/bin/cat \"$S/$A.market\")\" != \"$src\" ]; then",
	"      if [ \"$A\" = codex ]; then",
	"        echo \"Error: marketplace 'agent-board' is already added from a different source; remove it before adding this source\" >&2",
	"      else",
	"        echo '{\"outcome\":\"failed\",\"failureCode\":\"declared\",\"error\":\"source does not match\"}'",
	"      fi",
	"      exit 1",
	"    fi",
	"    printf '%s' \"$src\" > \"$S/$A.market\"",
	"    echo '{\"outcome\":\"ok\"}' ;;",
	"  \"plugin marketplace remove agent-board --json\")",
	"    /bin/rm -f \"$S/$A.market\" \"$S/$A.installed\"",
	"    echo '{}' ;;",
	"  \"plugin add agent-board@agent-board --json\"|\"plugin install agent-board@agent-board --json\")",
	"    if [ ! -f \"$S/$A.market\" ]; then echo \"no marketplace\" >&2; exit 1; fi",
	"    printf '%s' '@VERSION@' > \"$S/$A.installed\"",
	"    /bin/rm -f \"$S/$A.trusted\"",
	"    echo '{}' ;;",
	"  \"plugin update agent-board@agent-board --json\")",
	"    echo '{}' ;;",
	"  \"app-server\")",
	"    while IFS= read -r line; do",
	"      id=$(printf '%s' \"$line\" | /usr/bin/sed -n 's/^{\"id\":\\([0-9]*\\),.*/\\1/p')",
	"      case \"$line\" in",
	"        *'\"method\":\"initialize\",'*)",
	"          printf '{\"id\":%s,\"result\":{\"userAgent\":\"fake\"}}\\n' \"$id\" ;;",
	"        *'\"method\":\"hooks/list\"'*)",
	"          if [ -f \"$S/$A.trusted\" ]; then t=trusted; else t=untrusted; fi",
	"          printf '{\"method\":\"note\",\"params\":{}}\\n'",
	"          printf '{\"id\":%s,\"result\":{\"data\":[{\"cwd\":\"x\",\"hooks\":[{\"key\":\"agent-board@agent-board:hooks/codex.json:session_start:0:0\",\"currentHash\":\"sha256:aaa\",\"trustStatus\":\"%s\",\"pluginId\":\"agent-board@agent-board\"},{\"key\":\"agent-board@agent-board:hooks/codex.json:post_tool_use:0:0\",\"currentHash\":\"sha256:bbb\",\"trustStatus\":\"%s\",\"pluginId\":\"agent-board@agent-board\"},{\"key\":\"other@elsewhere:hooks.json:stop:0:0\",\"currentHash\":\"sha256:ccc\",\"trustStatus\":\"untrusted\",\"pluginId\":\"other@elsewhere\"}]}]}}\\n' \"$id\" \"$t\" \"$t\" ;;",
	"        *'\"method\":\"config/value/write\"'*)",
	"          printf '%s\\n' \"$line\" >> \"$S/trust-writes.log\"",
	"          : > \"$S/$A.trusted\"",
	"          printf '{\"id\":%s,\"result\":{\"status\":\"ok\"}}\\n' \"$id\" ;;",
	"      esac",
	"    done ;;",
	"  *)",
	"    echo \"fake: unexpected arguments: $*\" >&2",
	"    exit 1 ;;",
	"esac",
	"",
].join('\n');

/** Write fake `codex` and `claude` commands into `dir/bin` and return that folder. */
export function fakeAgents(dir: string, version: string): string {
	const bin = path.join(dir, 'bin');
	const state = path.join(dir, 'fake-state');
	mkdirSync(bin, { recursive: true });
	mkdirSync(state, { recursive: true });
	for (const agent of ['codex', 'claude']) {
		const file = path.join(bin, agent);
		writeFileSync(file, SCRIPT.replaceAll('@STATE@', state).replaceAll('@AGENT@', agent).replaceAll('@VERSION@', version));
		chmodSync(file, 0o755);
	}
	return bin;
}
