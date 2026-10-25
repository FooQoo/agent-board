"""Verify the CLI boundary of the default wait for a pending question.

Run: python3 scripts/verify-pending-default-wait.py --repo <worktree> --stage wave1
Uses a temporary data area per case and no server. This script is a local
integration check, not part of CI.
"""

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

QUESTION = {"question": "Which plan?",
            "choices": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}]}


def run_case(binary, name, request, extra, expect_code, expect_error, expect_status):
    with tempfile.TemporaryDirectory(prefix="agboard-default-wait-") as area:
        env = {**os.environ, "AGBOARD_HOME": area, "TZ": "UTC"}

        def cli(*command):
            return subprocess.run([str(binary), "--project", "Verification", *map(str, command), "--json"],
                                  cwd=area, env=env, capture_output=True, text=True, timeout=60)

        assert subprocess.run([str(binary), "project", "create", "Verification", "--folder", area],
                              cwd=area, env=env, capture_output=True, timeout=60).returncode == 0
        cli("add", "Ask", "--assignee", "ai", "--actor", "ai")
        before = cli("show", "1").stdout
        result = cli("state", "1", "pending", "--actor", "ai",
                     "--request-json", json.dumps(request), *extra)
        assert result.returncode == expect_code, (name, result.returncode, result.stdout, result.stderr)
        if expect_error:
            assert json.loads(result.stderr)["error"]["code"] == expect_error, (name, result.stderr)
            assert cli("show", "1").stdout == before, (name, "the task changed")
        else:
            assert "answer" not in json.loads(result.stdout), name
        status = json.loads(cli("show", "1").stdout)["task"]["agentStatus"]
        assert status == expect_status, (name, status)
        print(f"ok: {name}")


def wave1(binary):
    cases = [
        ("default wait without a server", QUESTION, [], 1, "board_unavailable", "idle"),
        ("wait:{} without a server", {**QUESTION, "wait": {}}, [], 1, "board_unavailable", "idle"),
        ("timeout without a server", {**QUESTION, "wait": {"timeoutSeconds": 5}}, [], 1,
         "board_unavailable", "idle"),
        ("--no-wait registers", QUESTION, ["--no-wait"], 0, None, "pending"),
        ("--no-wait with wait:{}", {**QUESTION, "wait": {}}, ["--no-wait"], 0, None, "pending"),
        ("--no-wait with a timeout", {**QUESTION, "wait": {"timeoutSeconds": 5}}, ["--no-wait"], 2,
         "invalid_argument", "idle"),
    ]
    for name, request, extra, code, error, status in cases:
        run_case(binary, name, request, extra, code, error, status)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--stage", choices=["wave1"], required=True)
    args = parser.parse_args()
    binary = args.repo.resolve() / "target/debug/agboard"
    assert binary.exists(), f"Build first: cargo build ({binary} is missing)"
    wave1(binary)
    print("all checks passed")


if __name__ == "__main__":
    main()
