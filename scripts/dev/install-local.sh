#!/usr/bin/env bash
# Install the local build with `cargo install` and, on macOS, re-sign it with
# the release identifier and a stable certificate so that the Keychain grant for
# the mobile-monitor token survives reinstalling.
#
# Usage:
#   scripts/dev/install-local.sh [extra cargo install args]
#
# Environment:
#   AGBOARD_CODESIGN_IDENTITY  signing identity (name or SHA-1) for codesign;
#                              list candidates with
#                              `security find-identity -v -p codesigning`.
#                              Unset: the binary keeps cargo's ad-hoc signature.
#   CARGO_INSTALL_ROOT         install root, as for `cargo install`
#                              (`--root` in the extra args takes precedence).
#   CARGO_HOME                 cargo home (default ~/.cargo).
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"

# The release identifier lives in one place: the release signing script.
identifier="$(sed -n 's/^IDENTIFIER=//p' scripts/release/sign-macos.sh | head -n 1)"
if [ -z "$identifier" ]; then
  echo "install-local: cannot read IDENTIFIER from scripts/release/sign-macos.sh" >&2
  exit 1
fi

cargo install --path . --locked --force "$@"

# Find the install root the way cargo does: --root, CARGO_INSTALL_ROOT, CARGO_HOME.
install_root="${CARGO_INSTALL_ROOT:-${CARGO_HOME:-$HOME/.cargo}}"
prev=""
for arg in "$@"; do
  case "$arg" in
    --root=*) install_root="${arg#--root=}" ;;
  esac
  if [ "$prev" = "--root" ]; then install_root="$arg"; fi
  prev="$arg"
done
binary="$install_root/bin/agboard"
if [ ! -x "$binary" ]; then
  echo "install-local: $binary not found after install" >&2
  exit 1
fi

if [ "$(uname -s)" = "Darwin" ] && [ -n "${AGBOARD_CODESIGN_IDENTITY:-}" ]; then
  codesign --force --identifier "$identifier" --sign "$AGBOARD_CODESIGN_IDENTITY" "$binary"
  codesign -dvv "$binary" 2>&1 | grep -E '^(Identifier|TeamIdentifier)=' || true
  echo "install-local: signed $binary as $identifier"
else
  echo "install-local: not signed, so the Keychain asks again after each reinstall. On macOS, set AGBOARD_CODESIGN_IDENTITY to a stable identity (see: security find-identity -v -p codesigning)."
fi
