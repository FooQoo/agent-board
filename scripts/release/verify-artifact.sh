#!/usr/bin/env bash
# Check a release archive before it is trusted.
#
# Usage: verify-artifact.sh <archive> <target>
#
# Fails unless: the file name matches the Cargo.toml version and the target;
# the archive holds exactly agboard, LICENSE and THIRD_PARTY_NOTICES.txt; the
# two license files equal the repository files; the binary is a Mach-O for
# only the target CPU, built for macOS 15.0, and links only system libraries;
# and, when this machine can run it, the extracted binary reports its version
# and serves the embedded web UI. The serve check listens on VERIFY_PORT
# (default 9040) on 127.0.0.1 with a temporary AGBOARD_HOME.
set -euo pipefail

archive=${1:?usage: verify-artifact.sh <archive> <target>}
target=${2:?usage: verify-artifact.sh <archive> <target>}
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
port=${VERIFY_PORT:-9040}

fail() { echo "verify-artifact: $*" >&2; exit 1; }

case "$target" in
  aarch64-apple-darwin) arch=arm64 ;;
  x86_64-apple-darwin) arch=x86_64 ;;
  *) fail "unsupported target: $target" ;;
esac
version=$(sed -n 's/^version = "\(.*\)"$/\1/p' "$root/Cargo.toml" | head -n 1)
[ -f "$archive" ] || fail "no such archive: $archive"
expected="agboard-$version-$target.tar.gz"
[ "$(basename "$archive")" = "$expected" ] || fail "archive is named $(basename "$archive"), expected $expected"

listing=$(tar -tzf "$archive" | sort | tr '\n' ' ')
for member in LICENSE THIRD_PARTY_NOTICES.txt agboard; do
  case " $listing" in *" $member "*) ;; *) fail "archive lacks $member" ;; esac
done
[ "$listing" = "LICENSE THIRD_PARTY_NOTICES.txt agboard " ] || fail "archive holds unexpected files: $listing"

work=$(mktemp -d)
server_pid=""
cleanup() {
  [ -z "$server_pid" ] || kill "$server_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
mkdir "$work/x"
tar -xzf "$archive" -C "$work/x"
for file in LICENSE THIRD_PARTY_NOTICES.txt; do
  [ -s "$work/x/$file" ] || fail "$file is empty"
  cmp -s "$work/x/$file" "$root/$file" || fail "$file differs from the repository file"
done

bin="$work/x/agboard"
[ -x "$bin" ] || fail "agboard is not executable"
kind=$(file -b "$bin")
case "$kind" in *Mach-O*) ;; *) fail "agboard is not a Mach-O executable: $kind" ;; esac
command -v lipo >/dev/null && command -v otool >/dev/null || fail "lipo and otool are required (run on macOS)"
[ "$(lipo -archs "$bin")" = "$arch" ] || fail "agboard holds '$(lipo -archs "$bin")', expected only '$arch'"

minos=$(otool -l "$bin" | awk '/LC_BUILD_VERSION/{f=1} /LC_VERSION_MIN_MACOSX/{f=1} f && ($1=="minos"||$1=="version"){print $2; exit}')
[ "$minos" = "15.0" ] || fail "deployment target is '$minos', expected 15.0"

bad=$(otool -L "$bin" | tail -n +2 | awk '{print $1}' | grep -v -e '^/usr/lib/' -e '^/System/Library/' || true)
[ -z "$bad" ] || fail "agboard links non-system libraries: $bad"

# The Skill and Hook files are used by `connect`. Until that command exists the
# linker drops them, so the marker is required only once `connect` is present.
if "$bin" --help 2>/dev/null | grep -q '^  connect'; then
  grep -aq 'Use Agent Board to plan and track work' "$bin" || fail "the Skill is not embedded in agboard"
else
  echo "verify-artifact: no connect command; Skill embedding not checked"
fi

host=$(uname -m)
runner=()
if [ "$host" != "$arch" ]; then
  if [ "$host" = arm64 ] && arch -x86_64 /usr/bin/true 2>/dev/null; then runner=(arch -x86_64); else
    echo "verify-artifact: static checks passed; $arch binary not executed on $host"
    exit 0
  fi
fi

export AGBOARD_HOME="$work/home" HOME="$work/home" TZ=UTC
mkdir -p "$AGBOARD_HOME"
reported=$(cd "$work/x" && ${runner[@]+"${runner[@]}"} ./agboard --version)
case "$reported" in *"$version"*) ;; *) fail "--version printed '$reported', expected $version" ;; esac

(cd "$work/x" && exec ${runner[@]+"${runner[@]}"} ./agboard serve --port "$port") >"$work/serve.log" 2>&1 &
server_pid=$!
page=""
for _ in $(seq 1 50); do
  page=$(curl -fsS "http://127.0.0.1:$port/" 2>/dev/null) && break
  sleep 0.2
done
[ -n "$page" ] || fail "serve did not answer on port $port: $(tail -n 3 "$work/serve.log")"
script=$(printf '%s' "$page" | grep -o 'src="[^"]*\.js"' | head -n 1 | sed 's/^src="//; s/"$//')
[ -n "$script" ] || fail "the served page names no script"
curl -fsS -o /dev/null "http://127.0.0.1:$port$script" || fail "the embedded script $script is not served"
kill "$server_pid"; wait "$server_pid" 2>/dev/null || true
server_pid=""
curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null && fail "port $port is still in use"
echo "verify-artifact: $expected ok ($reported)"
