#!/usr/bin/env bash
# Pack a release binary into agboard-<version>-<target>.tar.gz.
#
# Usage: package.sh <target> <binary> <out-dir>
#
# The archive holds exactly agboard, LICENSE and THIRD_PARTY_NOTICES.txt. The
# binary is packed as given: any strip step must run before this script, and
# before signing. The script refuses a binary built for another CPU.
set -euo pipefail

target=${1:?usage: package.sh <target> <binary> <out-dir>}
binary=${2:?usage: package.sh <target> <binary> <out-dir>}
out_dir=${3:?usage: package.sh <target> <binary> <out-dir>}
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

case "$target" in
  aarch64-apple-darwin) arch=arm64 ;;
  x86_64-apple-darwin) arch=x86_64 ;;
  *) echo "package: unsupported target: $target" >&2; exit 1 ;;
esac

version=$(sed -n 's/^version = "\(.*\)"$/\1/p' "$root/Cargo.toml" | head -n 1)
[ -n "$version" ] || { echo "package: no version in Cargo.toml" >&2; exit 1; }
[ -f "$binary" ] || { echo "package: no such binary: $binary" >&2; exit 1; }

actual=$(lipo -archs "$binary" 2>/dev/null || true)
if [ "$actual" != "$arch" ]; then
  echo "package: $binary holds '${actual:-no Mach-O slice}', expected only '$arch'" >&2
  exit 1
fi

name="agboard-$version-$target.tar.gz"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
install -m 755 "$binary" "$stage/agboard"
install -m 644 "$root/LICENSE" "$stage/LICENSE"
install -m 644 "$root/THIRD_PARTY_NOTICES.txt" "$stage/THIRD_PARTY_NOTICES.txt"
# Fixed timestamps and no gzip header time keep equal inputs byte-identical.
touch -t 202601010000 "$stage/agboard" "$stage/LICENSE" "$stage/THIRD_PARTY_NOTICES.txt"

mkdir -p "$out_dir"
COPYFILE_DISABLE=1 tar -cf - -C "$stage" agboard LICENSE THIRD_PARTY_NOTICES.txt | gzip -n -9 > "$out_dir/$name"
echo "$out_dir/$name"
