#!/usr/bin/env bash
# Verify the Developer ID signature of an agboard binary and describe it.
#
# Usage: verify-signature.sh <binary> <target> [--json FILE]
#
# Environment: APPLE_TEAM_ID (the expected Team ID, required);
#   EXPECTED_IDENTIFIER (default io.github.FooQoo.agent-board.agboard).
#
# Fails unless codesign verifies the binary strictly and reports the fixed
# identifier, the expected Team ID, a Developer ID Application authority,
# Hardened Runtime, a secure timestamp, and the default Developer ID
# designated requirement (no pinned hash). With --json, writes the public
# facts, including the SHA-256 of the signed bytes, for the release gate.
#
# Exit codes: 0 ok; 1 the signature does not meet the contract; 2 usage or a
# missing expected Team ID.
set -euo pipefail

binary=${1:?usage: verify-signature.sh <binary> <target> [--json FILE]}
target=${2:?usage: verify-signature.sh <binary> <target> [--json FILE]}
json_out=""
if [ "${3:-}" = "--json" ]; then json_out=${4:?--json needs a file}; fi
expected_id=${EXPECTED_IDENTIFIER:-io.github.FooQoo.agent-board.agboard}

fail() { echo "verify-signature: $*" >&2; exit 1; }
[ -n "${APPLE_TEAM_ID:-}" ] || { echo "verify-signature: APPLE_TEAM_ID (expected Team ID) is not set" >&2; exit 2; }
[ -f "$binary" ] || fail "no such binary: $binary"
team=$APPLE_TEAM_ID

codesign --verify --strict --verbose=4 "$binary" >/dev/null 2>&1 || fail "codesign --verify --strict failed"
details=$(codesign -dv --verbose=4 "$binary" 2>&1) || fail "codesign -dv failed"
requirement=$(codesign -dr - "$binary" 2>&1) || fail "codesign -dr failed"

line() { printf '%s\n' "$details" | sed -n "s/^$1=//p" | head -n 1; }
identifier=$(line Identifier)
team_found=$(line TeamIdentifier)
[ "$identifier" = "$expected_id" ] || fail "Identifier is '$identifier', expected $expected_id"
[ "$team_found" = "$team" ] || fail "TeamIdentifier is '$team_found', expected the configured Team ID"
printf '%s\n' "$details" | grep -q '^Signature=adhoc' && fail "the signature is ad hoc"
authority=$(printf '%s\n' "$details" | sed -n 's/^Authority=//p' | head -n 1)
case "$authority" in "Developer ID Application:"*) ;; *) fail "first Authority is not a Developer ID Application certificate" ;; esac
printf '%s\n' "$details" | grep -q '^CodeDirectory .*flags=0x[0-9a-f]*([^)]*runtime' || fail "Hardened Runtime is not enabled"
printf '%s\n' "$details" | grep -q '^Timestamp=' || fail "no secure timestamp"
printf '%s\n' "$requirement" | grep -q 'anchor apple generic' || fail "the designated requirement is not the Developer ID default"
printf '%s\n' "$requirement" | grep -q "leaf\[subject.OU\] = \"\{0,1\}$team" || fail "the designated requirement does not name the Team ID"
printf '%s\n' "$requirement" | grep -q 'cdhash' && fail "the designated requirement pins a binary hash"

sha=$(shasum -a 256 "$binary" | awk '{print $1}')
if [ -n "$json_out" ]; then
  python3 -I - "$json_out" "$target" "$identifier" "$team_found" "$authority" "$sha" <<'PY'
import json, os, sys
out, target, identifier, team, authority, sha = sys.argv[1:7]
record = {
    "target": target,
    "identifier": identifier,
    "team_id": team,
    "authority": authority,
    "runtime": True,
    "timestamp": True,
    "binary_sha256": sha,
    "sha": os.environ.get("GITHUB_SHA", ""),
    "run_id": os.environ.get("GITHUB_RUN_ID", ""),
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(record, f, indent=2, sort_keys=True)
    f.write("\n")
PY
fi
echo "verify-signature: $target ok (identifier $identifier, runtime, timestamp, sha256 $sha)"
