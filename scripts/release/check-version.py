#!/usr/bin/env python3
"""Fail unless a release tag matches the Cargo.toml and Cargo.lock versions.

Usage: check-version.py --tag v1.0.0 [--root DIR] [--assets DIR]

With --assets, DIR must also hold exactly the two per-CPU archives of that
version (aarch64 and x86_64) and nothing else, so a missing CPU, a stray file,
or an archive of another version fails the check.

The tag must be exactly "v" followed by a plain MAJOR.MINOR.PATCH version.
Prints the version on success; exits 1 with a reason on any mismatch.
"""
import argparse
import re
import sys
import tomllib
from pathlib import Path

TAG = re.compile(r"^v(\d+\.\d+\.\d+)$")


def fail(message):
    print(f"check-version: {message}", file=sys.stderr)
    sys.exit(1)


def manifest_version(root):
    data = tomllib.loads((root / "Cargo.toml").read_text(encoding="utf-8"))
    return data["package"]["version"], data["package"]["name"]


def lock_version(root, name):
    data = tomllib.loads((root / "Cargo.lock").read_text(encoding="utf-8"))
    found = [p["version"] for p in data.get("package", []) if p["name"] == name]
    if len(found) != 1:
        fail(f"Cargo.lock must hold exactly one {name} package, found {len(found)}")
    return found[0]


def check_assets(directory, version):
    expected = {f"agboard-{version}-{t}.tar.gz" for t in ("aarch64-apple-darwin", "x86_64-apple-darwin")}
    found = {p.name for p in Path(directory).iterdir()} if Path(directory).is_dir() else set()
    if found != expected:
        fail(f"assets in {directory} differ: missing {sorted(expected - found)}, unexpected {sorted(found - expected)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tag", required=True, help="release tag, e.g. v1.0.0")
    parser.add_argument("--assets", help="directory that must hold the two archives")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    args = parser.parse_args()
    root = Path(args.root)
    match = TAG.match(args.tag)
    if not match:
        fail(f"tag {args.tag!r} is not of the form vMAJOR.MINOR.PATCH")
    version, name = manifest_version(root)
    locked = lock_version(root, name)
    if version != locked:
        fail(f"Cargo.toml says {version} but Cargo.lock says {locked}")
    if match.group(1) != version:
        fail(f"tag {args.tag} does not match Cargo.toml version {version}")
    if args.assets:
        check_assets(args.assets, version)
    print(version)


if __name__ == "__main__":
    main()
