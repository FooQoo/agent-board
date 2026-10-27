#!/usr/bin/env python3
"""Integration checks for a set of merged units. Run by hand, not by CI.

Usage: verify-wave.py --repo <worktree> --wave <N>

Each wave runs the commands below from the repository root with TZ=UTC and a
fresh temporary AGBOARD_HOME. Any failing command stops the run with a
non-zero exit code.
"""

import argparse
import os
import subprocess
import sys
import tempfile

FOCUSED_TESTS = [
    "--test", "integration_assets",
    "--test", "integration_paths",
    "--test", "agent_hook",
    "--test", "project_bindings",
    "--test", "agent_projects",
    "--test", "cli_projects",
]

WAVES = {
    "1": [
        ["pnpm", "--dir", "web", "build"],
        ["cargo", "build"],
        ["cargo", "test", *FOCUSED_TESTS],
        ["cargo", "test"],
    ],
    "2": [
        ["pnpm", "--dir", "web", "build"],
        ["cargo", "build"],
        [
            "cargo", "test", *FOCUSED_TESTS,
            "--test", "integration_install",
            "--test", "integration_recovery",
            "--test", "setup",
            "--test", "release_metadata",
        ],
        ["python3", "scripts/release/check-version.py", "--tag", "v1.0.0"],
        ["cargo", "test"],
    ],
    "3": [
        ["pnpm", "--dir", "web", "build"],
        ["cargo", "build"],
        [
            "cargo", "test", *FOCUSED_TESTS,
            "--test", "integration_install",
            "--test", "integration_recovery",
            "--test", "setup",
            "--test", "release_metadata",
            "--test", "integration_connect",
            "--test", "agent_templates",
        ],
        ["bash", "scripts/release/test-formula.sh"],
        ["python3", "scripts/release/check-version.py", "--tag", "v1.0.0"],
        ["cargo", "test"],
    ],
    "4": [
        ["pnpm", "--dir", "web", "build"],
        ["cargo", "build"],
        [
            "cargo", "test", *FOCUSED_TESTS,
            "--test", "integration_install",
            "--test", "integration_recovery",
            "--test", "setup",
            "--test", "release_metadata",
            "--test", "integration_connect",
            "--test", "agent_templates",
            "--test", "integration_update",
            "--test", "integration_notice",
            "--test", "release_signing",
        ],
        ["bash", "scripts/release/test-formula.sh"],
        ["python3", "scripts/release/check-version.py", "--tag", "v1.0.0"],
        ["cargo", "test"],
    ],
    "4.5": [
        ["pnpm", "--dir", "web", "build"],
        ["cargo", "build"],
        ["cargo", "test", "--test", "integration_connect", "--test", "integration_update"],
        ["cargo", "test"],
        ["pnpm", "--dir", "web", "typecheck"],
        ["pnpm", "--dir", "web", "check"],
        ["pnpm", "--dir", "web", "test"],
        ["pnpm", "--dir", "web", "typecheck:storybook"],
        ["pnpm", "--dir", "web", "test:storybook"],
        ["pnpm", "--dir", "web", "build-storybook"],
        ["pnpm", "--dir", "web", "verify:story-coverage"],
    ],
}


def run(repo, env, command):
    print(f"$ {' '.join(command)}", flush=True)
    result = subprocess.run(command, cwd=repo, env=env)
    if result.returncode != 0:
        print(f"FAILED ({result.returncode}): {' '.join(command)}", file=sys.stderr)
        sys.exit(result.returncode or 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", required=True, help="worktree to verify")
    parser.add_argument("--wave", required=True)
    args = parser.parse_args()

    if args.wave not in WAVES:
        sys.exit(f"no checks are defined for wave {args.wave} yet")

    repo = os.path.abspath(args.repo)
    with tempfile.TemporaryDirectory(prefix="agboard-wave-") as home:
        env = dict(os.environ, TZ="UTC", AGBOARD_HOME=home)
        for command in WAVES[args.wave]:
            run(repo, env, command)
    print(f"wave {args.wave}: all checks passed")


if __name__ == "__main__":
    main()
