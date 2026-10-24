#!/usr/bin/env python3
"""Decide whether the signed archives of both CPUs may become a Release draft.

Usage: release-gate.py --evidence DIR --version X.Y.Z --out DIR
                       [--sha SHA] [--team-id TEAM]

DIR holds one sub-directory per target (aarch64-apple-darwin and
x86_64-apple-darwin) with signature.json, notary.json, and the final archive
agboard-<version>-<target>.tar.gz. The gate passes only when, for BOTH CPUs:

  * the signature record names the fixed identifier, a Developer ID
    Application authority, Hardened Runtime and a secure timestamp;
  * both CPUs carry the same Team ID (and --team-id, when given);
  * the notary record is status Accepted with a submission ID;
  * the SHA-256 of the signed binary, of the notarized binary, and of the
    binary inside the final archive are the same bytes;
  * the archive holds exactly agboard, LICENSE and THIRD_PARTY_NOTICES.txt;
  * the run SHA matches --sha when the record carries one.

Any missing piece, including a whole CPU, fails the gate: there is no unsigned
fallback. On success it writes OUT/assets/ (the two archives) and
OUT/assets/SHA256SUMS. On failure it writes nothing and exits 1 after listing
every problem.
"""
import argparse
import hashlib
import json
import shutil
import sys
import tarfile
from pathlib import Path

IDENTIFIER = "io.github.FooQoo.agent-board.agboard"
TARGETS = ("aarch64-apple-darwin", "x86_64-apple-darwin")
MEMBERS = {"agboard", "LICENSE", "THIRD_PARTY_NOTICES.txt"}


def load(path, problems, label):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        problems.append(f"{label}: {path.name} is missing")
    except (ValueError, OSError):
        problems.append(f"{label}: {path.name} is unreadable")
    return None


def archive_binary_sha(path, problems, label):
    try:
        with tarfile.open(path, "r:gz") as tar:
            names = {m.name for m in tar.getmembers()}
            if names != MEMBERS:
                problems.append(f"{label}: archive holds {sorted(names)}, expected {sorted(MEMBERS)}")
                return None
            return hashlib.sha256(tar.extractfile("agboard").read()).hexdigest()
    except (tarfile.TarError, OSError):
        problems.append(f"{label}: the archive cannot be read")
        return None


def check_target(evidence, target, version, expect_sha, problems):
    label = target
    directory = evidence / target
    archive = directory / f"agboard-{version}-{target}.tar.gz"
    sig = load(directory / "signature.json", problems, label)
    notary = load(directory / "notary.json", problems, label)
    if not archive.is_file():
        problems.append(f"{label}: {archive.name} is missing")
    if sig is not None:
        if sig.get("target") != target:
            problems.append(f"{label}: the signature record is for {sig.get('target')!r}")
        if sig.get("identifier") != IDENTIFIER:
            problems.append(f"{label}: identifier is {sig.get('identifier')!r}, expected {IDENTIFIER}")
        if not str(sig.get("authority", "")).startswith("Developer ID Application:"):
            problems.append(f"{label}: authority is not a Developer ID Application certificate")
        if sig.get("runtime") is not True:
            problems.append(f"{label}: Hardened Runtime is not recorded")
        if sig.get("timestamp") is not True:
            problems.append(f"{label}: no secure timestamp is recorded")
        if not sig.get("team_id"):
            problems.append(f"{label}: no Team ID is recorded")
        if expect_sha and sig.get("sha") and sig["sha"] != expect_sha:
            problems.append(f"{label}: signed from {sig['sha']}, expected {expect_sha}")
    if notary is not None:
        if notary.get("target") != target:
            problems.append(f"{label}: the notary record is for {notary.get('target')!r}")
        if notary.get("status") != "Accepted" or not notary.get("submission_id"):
            problems.append(f"{label}: notarization is '{notary.get('status')}', not Accepted")
    packed = archive_binary_sha(archive, problems, label) if archive.is_file() else None
    if sig is not None and notary is not None and packed is not None:
        hashes = {sig.get("binary_sha256"), notary.get("binary_sha256"), packed}
        if len(hashes) != 1:
            problems.append(f"{label}: the signed, notarized and packed binaries are not the same bytes")
    return sig, archive


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--sha", default="")
    parser.add_argument("--team-id", default="")
    args = parser.parse_args()
    evidence = Path(args.evidence)
    problems = []
    sigs, archives = {}, {}
    for target in TARGETS:
        if not (evidence / target).is_dir():
            problems.append(f"{target}: no signing evidence (that CPU did not finish)")
            continue
        sigs[target], archives[target] = check_target(evidence, target, args.version, args.sha, problems)
    teams = {s.get("team_id") for s in sigs.values() if s}
    if len(teams) > 1:
        problems.append("the two CPUs were signed with different Team IDs")
    if args.team_id and teams and teams != {args.team_id}:
        problems.append("the Team ID differs from the expected Team ID")
    if problems:
        for problem in problems:
            print(f"release-gate: {problem}", file=sys.stderr)
        print("release-gate: FAILED, no formal release", file=sys.stderr)
        return 1
    assets = Path(args.out) / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    lines = []
    for target in TARGETS:
        src = archives[target]
        shutil.copyfile(src, assets / src.name)
        lines.append(f"{hashlib.sha256(src.read_bytes()).hexdigest()}  {src.name}")
    (assets / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"release-gate: both CPUs passed; wrote {assets}/SHA256SUMS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
