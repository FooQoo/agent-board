#!/usr/bin/env bash
# Sign the agboard binary with a Developer ID Application certificate held in
# a temporary keychain that lives only for the CI job.
#
# Usage:
#   sign-macos.sh prepare        create the keychain, import the certificate,
#                                resolve the one signing identity, and export
#                                SIGNING_KEYCHAIN_PATH / SIGNING_IDENTITY to
#                                $GITHUB_ENV
#   sign-macos.sh sign <binary>  sign the binary in place
#   sign-macos.sh cleanup        delete the keychain and the key material and
#                                restore the keychain search list (idempotent;
#                                run it from an always() step)
#
# Secrets arrive only through the environment and are never printed:
#   MACOS_CERT_P12, MACOS_CERT_PASSWORD, APPLE_TEAM_ID  (prepare)
# The script needs RUNNER_TEMP (a per-job directory) and GITHUB_ENV.
#
# Exit codes: 0 ok; 1 a tool step failed; 2 a required secret or setting is
# missing (no formal release may follow); 3 the certificate does not resolve
# to exactly one Developer ID Application identity of the expected Team.
set -euo pipefail

IDENTIFIER=io.github.FooQoo.agent-board.agboard

die() { echo "sign-macos: $*" >&2; exit "${2:-1}"; }
need() { [ -n "${!1:-}" ] || die "required setting $1 is not set" 2; }

state_dir() { need RUNNER_TEMP; printf '%s/agboard-signing' "$RUNNER_TEMP"; }

cleanup() {
  local dir kc
  dir=$(state_dir)
  [ -d "$dir" ] || return 0
  if [ -f "$dir/search-list" ]; then
    local list=()
    while IFS= read -r line; do [ -z "$line" ] || list+=("$line"); done < "$dir/search-list"
    if [ "${#list[@]}" -gt 0 ]; then
      security list-keychains -d user -s "${list[@]}" >/dev/null 2>&1 || true
    fi
  fi
  if [ -f "$dir/keychain-path" ]; then
    kc=$(cat "$dir/keychain-path")
    security delete-keychain "$kc" >/dev/null 2>&1 || true
  fi
  rm -rf "$dir"
}

prepare() {
  need MACOS_CERT_P12
  need MACOS_CERT_PASSWORD
  need APPLE_TEAM_ID
  need GITHUB_ENV
  local dir kc pw
  dir=$(state_dir)
  [ ! -e "$dir" ] || die "a signing keychain already exists for this job" 1
  mkdir -m 700 -p "$dir"
  # Any exit before the keychain is ready removes what was created.
  trap 'cleanup' EXIT

  security list-keychains -d user | sed 's/^[[:space:]]*"\{0,1\}//; s/"\{0,1\}$//' > "$dir/search-list"
  kc="$dir/agboard-signing.keychain-db"
  printf '%s' "$kc" > "$dir/keychain-path"
  # The keychain password is random per job and never stored as a Secret.
  pw=$(openssl rand -hex 24)

  printf '%s' "$MACOS_CERT_P12" | base64 -d > "$dir/cert.p12" || die "the certificate secret is not valid base64" 2
  [ -s "$dir/cert.p12" ] || die "the certificate secret decoded to nothing" 2

  security create-keychain -p "$pw" "$kc"
  security set-keychain-settings -lut 21600 "$kc"
  security unlock-keychain -p "$pw" "$kc"
  security import "$dir/cert.p12" -k "$kc" -P "$MACOS_CERT_PASSWORD" -T /usr/bin/codesign >/dev/null \
    || die "the certificate could not be imported" 2
  rm -f "$dir/cert.p12"
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$pw" "$kc" >/dev/null
  # Search the job keychain first, then whatever was there before.
  local list=()
  while IFS= read -r line; do [ -z "$line" ] || list+=("$line"); done < "$dir/search-list"
  security list-keychains -d user -s "$kc" ${list[@]+"${list[@]}"} >/dev/null

  local found count
  found=$(security find-identity -v -p codesigning "$kc" \
    | grep -F 'Developer ID Application:' | grep -F "($APPLE_TEAM_ID)\"" || true)
  count=$(printf '%s' "$found" | grep -c . || true)
  [ "$count" = 1 ] || die "expected exactly one Developer ID Application identity for the Team, found $count" 3
  # The SHA-1 hash selects the identity exactly; a name would match loosely.
  local identity
  identity=$(printf '%s' "$found" | awk '{print $2}')
  [ -n "$identity" ] || die "the identity has no hash" 3
  {
    echo "SIGNING_KEYCHAIN_PATH=$kc"
    echo "SIGNING_IDENTITY=$identity"
  } >> "$GITHUB_ENV"
  trap - EXIT
  echo "sign-macos: signing keychain ready, one Developer ID Application identity resolved"
}

sign() {
  local binary=${1:?usage: sign-macos.sh sign <binary>}
  need SIGNING_KEYCHAIN_PATH
  need SIGNING_IDENTITY
  [ -f "$binary" ] || die "no such binary: $binary" 1
  # Hardened Runtime and a secure timestamp are mandatory. No entitlements are
  # added: the binary needs none.
  codesign --force --options runtime --timestamp \
    --identifier "$IDENTIFIER" \
    --keychain "$SIGNING_KEYCHAIN_PATH" \
    --sign "$SIGNING_IDENTITY" "$binary" || die "codesign failed" 1
  codesign --verify --strict --verbose=4 "$binary" || die "the signature does not verify" 1
  echo "sign-macos: signed $(basename "$binary") as $IDENTIFIER"
}

case "${1:-}" in
  prepare) prepare ;;
  sign) shift; sign "$@" ;;
  cleanup) cleanup ;;
  *) die "usage: sign-macos.sh prepare | sign <binary> | cleanup" 2 ;;
esac
