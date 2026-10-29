#!/usr/bin/env bash
# Notarize a signed agboard binary and record the result.
#
# Usage: notarize-macos.sh <signed-binary> <target> <out-dir>
#
# The binary is zipped (notarytool takes ZIP, DMG or PKG, never a tar.gz),
# submitted with --wait, and accepted only when notarytool exits 0 and reports
# status Accepted. Writes <out-dir>/notary.json (target, submission ID,
# status, SHA-256 of the signed binary and of the zip) and, on any non-Accepted
# result, a redacted <out-dir>/notary-log.json. A single Mach-O cannot be
# stapled; the ticket is checked online by Gatekeeper, and no stapler step is
# part of this contract.
#
# Environment (secrets, never printed, never on a command line):
#   APP_STORE_CONNECT_API_KEY   the contents of the App Store Connect .p8 key
#   APP_STORE_CONNECT_KEY_ID    the key's ID
#   APP_STORE_CONNECT_ISSUER_ID the issuer UUID
# notarytool reads the key only from a file, so the key is written to a 0600
# file in a private temporary folder and passed as `--key <path>`. The folder
# (and so the key file) is removed on every exit, success or failure.
# NOTARY_RESUME_ID: continue an earlier submission with `notarytool info`
#   instead of submitting again. NOTARY_TIMEOUT (default 30m) bounds the wait.
#
# Exit codes: 0 Accepted; 2 credentials missing; 4 the service rejected the
# submission (Invalid or Rejected); 5 anything else (command failure, timeout,
# In Progress, unreadable result). Only 0 may lead to a release.
set -euo pipefail

binary=${1:?usage: notarize-macos.sh <signed-binary> <target> <out-dir>}
target=${2:?usage: notarize-macos.sh <signed-binary> <target> <out-dir>}
out=${3:?usage: notarize-macos.sh <signed-binary> <target> <out-dir>}

die() { echo "notarize-macos: $*" >&2; exit "$1"; }
for name in APP_STORE_CONNECT_API_KEY APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_ISSUER_ID; do
  [ -n "${!name:-}" ] || { echo "notarize-macos: required setting $name is not set" >&2; exit 2; }
done
[ -f "$binary" ] || { echo "notarize-macos: no such binary: $binary" >&2; exit 5; }
mkdir -p "$out"
umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
keyfile="$work/AuthKey.p8"
: > "$keyfile"
chmod 600 "$keyfile"
printf '%s\n' "$APP_STORE_CONNECT_API_KEY" > "$keyfile"

binary_sha=$(shasum -a 256 "$binary" | awk '{print $1}')
mkdir "$work/zip"
cp "$binary" "$work/zip/agboard"
zip="$work/agboard-$target.zip"
ditto -c -k "$work/zip/agboard" "$zip" || die 5 "could not create the submission zip"
zip_sha=$(shasum -a 256 "$zip" | awk '{print $1}')

creds=(--key "$keyfile" --key-id "$APP_STORE_CONNECT_KEY_ID" --issuer "$APP_STORE_CONNECT_ISSUER_ID")
rc=0
if [ -n "${NOTARY_RESUME_ID:-}" ]; then
  xcrun notarytool info "$NOTARY_RESUME_ID" "${creds[@]}" --output-format json > "$work/result.json" 2> "$work/err.txt" || rc=$?
else
  xcrun notarytool submit "$zip" "${creds[@]}" --wait --timeout "${NOTARY_TIMEOUT:-30m}" \
    --output-format json > "$work/result.json" 2> "$work/err.txt" || rc=$?
fi

# Parse the result; secrets are scrubbed from anything that is kept.
parsed=$(python3 -I - "$work/result.json" <<'PY' || true
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    print(data.get("id", ""), data.get("status", ""), sep="\t")
except Exception:
    print("", "", sep="\t")
PY
)
id=${parsed%%$'\t'*}
status=${parsed#*$'\t'}

# A failing tool never leaves an Accepted record behind.
record_status=$status
if [ "$rc" != 0 ] && [ "$status" = Accepted ]; then record_status=Unknown; fi

python3 -I - "$out/notary.json" "$target" "$id" "$record_status" "$binary_sha" "$zip_sha" <<'PY'
import json, sys
out, target, sid, status, bsha, zsha = sys.argv[1:7]
with open(out, "w", encoding="utf-8") as f:
    json.dump({"target": target, "submission_id": sid, "status": status or "Unknown",
               "binary_sha256": bsha, "zip_sha256": zsha}, f, indent=2, sort_keys=True)
    f.write("\n")
PY

if [ "$rc" = 0 ] && [ "$status" = Accepted ] && [ -n "$id" ]; then
  echo "notarize-macos: $target Accepted (submission $id)"
  exit 0
fi

# Keep a redacted log of the failure for the run, then stop the release.
if [ -n "$id" ]; then
  xcrun notarytool log "$id" "${creds[@]}" "$out/notary-log.raw.json" >/dev/null 2>&1 || true
fi
rm -f "$keyfile"
python3 -I - "$out" <<'PY'
import os, sys
out = sys.argv[1]
raw = os.path.join(out, "notary-log.raw.json")
if os.path.exists(raw):
    text = open(raw, encoding="utf-8", errors="replace").read()
    values = []
    for name in ("APP_STORE_CONNECT_API_KEY", "APP_STORE_CONNECT_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID"):
        value = os.environ.get(name)
        if value:
            values.append(value)
            if "\n" in value:
                values.extend(line for line in value.splitlines() if len(line.strip()) >= 8)
    for value in sorted(set(values), key=len, reverse=True):
        text = text.replace(value, "[redacted]")
    open(os.path.join(out, "notary-log.json"), "w", encoding="utf-8").write(text)
    os.remove(raw)
PY
echo "notarize-macos: $target not accepted (status '${status:-none}', notarytool exit $rc, submission '${id:-none}')" >&2
case "$status" in
  Invalid|Rejected) exit 4 ;;
  *) exit 5 ;;
esac
