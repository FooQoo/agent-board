#!/usr/bin/env bash
# Check the Homebrew Formula generator against local fixtures only.
#
# Usage: test-formula.sh
#
# Runs the generator self-test, renders the fixture SHA256SUMS and compares the
# result byte for byte with tests/fixtures/release/agboard.rb.expected, checks
# the Ruby syntax, then builds throwaway archives and replays the Formula's
# install and test steps on the host CPU: the binary must come out of the
# install byte-identical, LICENSE and THIRD_PARTY_NOTICES.txt must land in
# pkgshare, and the version and temporary-data checks must pass.
#
# It never touches the network, the Tap, or a real Homebrew. Set AGBOARD_BIN to
# replay the test block against a real binary instead of the stand-in script.
# RUBY overrides the Ruby used for `ruby -c` (default: /usr/bin/ruby, then ruby).
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
fixtures="$root/tests/fixtures/release"
render="$root/scripts/release/render-formula.py"
export TZ=UTC

fail() { echo "test-formula: $*" >&2; exit 1; }

ruby_bin=${RUBY:-}
if [ -z "$ruby_bin" ]; then
  if [ -x /usr/bin/ruby ]; then ruby_bin=/usr/bin/ruby; else ruby_bin=ruby; fi
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# 1. The generator's own refusal cases.
python3 -I "$render" --self-test

# 2. Fixture render: exact output and Ruby syntax.
python3 -I "$render" --tag v1.0.0 --sums "$fixtures/SHA256SUMS" --out "$work/fixture.rb"
cmp "$work/fixture.rb" "$fixtures/agboard.rb.expected" || fail "fixture render differs from agboard.rb.expected"
"$ruby_bin" -c "$work/fixture.rb" >/dev/null || fail "ruby -c rejected the rendered Formula"
# `brew style` refuses a Formula that is not readable by everyone.
mode=$(stat -f %Lp "$work/fixture.rb" 2>/dev/null || stat -c %a "$work/fixture.rb")
[ "$mode" = 644 ] || fail "the rendered Formula has mode $mode, not 644"

# 3. Forbidden content: no build dependencies, no binary rewriting, no latest URL.
for pattern in 'depends_on "rust' 'depends_on "node' 'depends_on "git' ':build' 'strip' 'install_name_tool' 'lipo' 'codesign' 'latest' 'cargo' 'pnpm'; do
  if grep -n -- "$pattern" "$work/fixture.rb" | grep -v '^[0-9]*: *#'; then
    fail "Formula contains forbidden text: $pattern"
  fi
done
[ "$(grep -c 'sha256 "' "$work/fixture.rb")" = 2 ] || fail "expected exactly two sha256 lines"
[ "$(grep -c 'releases/download/v1.0.0/' "$work/fixture.rb")" = 2 ] || fail "expected two URLs pinned to the v1.0.0 Release"

# 4. Throwaway archives for the host CPU, then the install and test replay.
case "$(uname -m)" in
  arm64) target=aarch64-apple-darwin ;;
  x86_64) target=x86_64-apple-darwin ;;
  *) fail "unsupported host CPU: $(uname -m)" ;;
esac
other=x86_64-apple-darwin
[ "$target" = x86_64-apple-darwin ] && other=aarch64-apple-darwin

stage="$work/stage"
mkdir -p "$stage" "$work/assets"
if [ -n "${AGBOARD_BIN:-}" ]; then
  cp "$AGBOARD_BIN" "$stage/agboard"
else
  cat > "$stage/agboard" <<'STUB'
#!/bin/sh
# Stand-in for the real binary: answers what the Formula test block asks.
case "$1" in
  --version) echo "agboard 1.0.0" ;;
  project) [ "$2" = create ] && mkdir -p "${AGBOARD_HOME:?}" && echo "Created project \"$3\" and bound it to this folder." ;;
  progress) echo "No tasks to pick up." ;;
  *) exit 2 ;;
esac
STUB
fi
chmod 755 "$stage/agboard"
printf 'fixture licence text\n' > "$stage/LICENSE"
printf 'fixture notices text\n' > "$stage/THIRD_PARTY_NOTICES.txt"
for t in "$target" "$other"; do
  tar -cf - -C "$stage" agboard LICENSE THIRD_PARTY_NOTICES.txt | gzip -n -9 > "$work/assets/agboard-1.0.0-$t.tar.gz"
done
(cd "$work/assets" && shasum -a 256 agboard-1.0.0-*.tar.gz > "$work/SHA256SUMS")

python3 -I "$render" --tag v1.0.0 --sums "$work/SHA256SUMS" --assets "$work/assets" --out "$work/local.rb"
python3 -I "$render" --tag v1.0.0 --sums "$work/SHA256SUMS" --assets "$work/assets" --out "$work/local2.rb"
cmp "$work/local.rb" "$work/local2.rb" || fail "rendering twice gave different Formulas"
"$ruby_bin" -c "$work/local.rb" >/dev/null || fail "ruby -c rejected the local Formula"

# A tampered archive must stop the render and leave no Formula behind.
cp "$work/assets/agboard-1.0.0-$other.tar.gz" "$work/keep.tar.gz"
printf 'x' >> "$work/assets/agboard-1.0.0-$other.tar.gz"
if python3 -I "$render" --tag v1.0.0 --sums "$work/SHA256SUMS" --assets "$work/assets" --out "$work/tampered.rb" 2>"$work/err"; then
  fail "a tampered archive was accepted"
fi
grep -q 'does not match' "$work/err" || fail "tampered archive failed for the wrong reason: $(cat "$work/err")"
[ ! -e "$work/tampered.rb" ] || fail "a Formula was written for a tampered archive"
mv "$work/keep.tar.gz" "$work/assets/agboard-1.0.0-$other.tar.gz"

# Install: bin.install agboard; pkgshare.install LICENSE, THIRD_PARTY_NOTICES.txt.
prefix="$work/prefix"
mkdir -p "$prefix/bin" "$prefix/share/agboard" "$work/x"
tar -xzf "$work/assets/agboard-1.0.0-$target.tar.gz" -C "$work/x"
sums_before=$(shasum -a 256 "$work/x/agboard" | cut -d' ' -f1)
install -m 755 "$work/x/agboard" "$prefix/bin/agboard"
install -m 644 "$work/x/LICENSE" "$work/x/THIRD_PARTY_NOTICES.txt" "$prefix/share/agboard/"
sums_after=$(shasum -a 256 "$prefix/bin/agboard" | cut -d' ' -f1)
[ "$sums_before" = "$sums_after" ] || fail "the installed binary differs from the archive binary"
for f in LICENSE THIRD_PARTY_NOTICES.txt; do
  [ -s "$prefix/share/agboard/$f" ] || fail "$f is missing or empty in pkgshare"
  cmp -s "$prefix/share/agboard/$f" "$work/x/$f" || fail "$f differs after install"
done

# Test block: version, then project create and progress with temporary data only.
"$prefix/bin/agboard" --version | grep -q '1\.0\.0' || fail "--version does not report 1.0.0"
mkdir -p "$work/testpath/work"
(
  cd "$work/testpath/work"
  AGBOARD_HOME="$work/testpath/agboard-home" "$prefix/bin/agboard" project create "Formula Test" >/dev/null
  out=$(AGBOARD_HOME="$work/testpath/agboard-home" "$prefix/bin/agboard" progress)
  case "$out" in *"No tasks to pick up."*) ;; *) echo "test-formula: unexpected progress output: $out" >&2; exit 1 ;; esac
)
[ -d "$work/testpath/agboard-home" ] || fail "the test did not use the temporary AGBOARD_HOME"

echo "test-formula: ok ($target)"
