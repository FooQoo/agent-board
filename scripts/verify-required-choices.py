"""Verify decision limits across CLI, files, and the board API.

Run after building: python3 scripts/verify-required-choices.py
Uses only a temporary data area and loopback ports. This script is a local
integration check, not part of CI.
"""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from verification_runtime import serve


def choices(count):
    return [{"id": f"option-{i}", "label": f"Option {i}"} for i in range(count)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path,
                        default=Path(__file__).resolve().parents[1] / "target/debug/agboard")
    parser.add_argument("--port", type=int, default=8940)
    args = parser.parse_args()
    binary = args.binary.resolve()
    with tempfile.TemporaryDirectory(prefix="agboard-choice-verification-") as area:
        home = Path(area)
        env = {**os.environ, "AGBOARD_HOME": area, "TZ": "UTC"}

        def cli(*command, valid=True):
            result = subprocess.run([str(binary), *map(str, command), "--json"],
                                    cwd=home, env=env, capture_output=True, text=True)
            assert (result.returncode == 0) == valid, (command, result.stdout, result.stderr)
            # Errors are JSON on standard error; successes on standard output.
            return json.loads(result.stdout or result.stderr)

        def project(*command, **options):
            return cli("--project", "Verification", *command, **options)

        cli("project", "create", "Verification", "--folder", area)
        project_id = cli("project", "ls")["projects"][0]["id"]
        task_id = project("add", "Decision limits", "--assignee", "ai", "--actor", "ai")["task"]["id"]
        task_api = f"/api/projects/{project_id}/tasks/{task_id}"
        with serve(binary, home, args.port):
            origin = f"http://127.0.0.1:{args.port}"

            with urlopen(origin + "/") as response:
                html = response.read().decode()
            match = re.search(r'<meta\s+name="agboard-token"\s+content="([^"]+)"', html)
            assert match, "Missing agboard-token"
            board_token = match[1]

            def post(path, data, status=200):
                request = Request(origin + path, data=json.dumps(data).encode(), method="POST",
                                  headers={"Content-Type": "application/json",
                                           "Origin": origin,
                                           "Host": f"127.0.0.1:{args.port}",
                                           "Sec-Fetch-Site": "same-origin",
                                           "X-Agboard-Token": board_token})
                try:
                    response = urlopen(request)
                except HTTPError as error:
                    response = error
                with response:
                    body = json.loads(response.read())
                    assert response.status == status, (path, status, response.status, body)
                return body

            for count in (0, 1, 11):
                request = {"question": "Choose a plan", "choices": choices(count)}
                rejected = project("state", task_id, "pending", "--actor", "ai",
                                   "--request-json", json.dumps(request), valid=False)
                assert rejected["error"]["code"] == "invalid_value", rejected
                rejected = post(task_api + "/agent-status",
                                {"agentStatus": "pending", "reason": request["question"],
                                 "choices": request["choices"]}, status=422)
                assert rejected["error"]["code"] == "invalid_value", rejected
                assert project("show", task_id)["task"]["agentStatus"] == "idle"

            for count, answer in ((2, {"choiceId": "option-0"}),
                                  (10, {"text": "A custom answer"}),
                                  (2, {"choiceId": "option-1", "text": "With context"})):
                project("state", task_id, "pending", "--actor", "ai", "--request-json",
                        json.dumps({"question": "Choose a plan", "choices": choices(count)}))
                requested = project("show", task_id)["task"]
                assert len(requested["pendingChoices"]) == count
                answered = post(task_api + "/answer", {"requestId": requested["pendingRequestId"], **answer})
                assert answered["task"]["agentStatus"] == "idle", answered
                stored = project("show", task_id)["task"]
                assert stored["pendingRequestId"] is None
                assert stored["pendingChoices"] == []
                note = stored["history"][-1]["reason"]
                assert "Choose a plan" in note
                if "choiceId" in answer:
                    assert choices(count)[int(answer["choiceId"].split("-")[-1])]["label"] in note
                if "text" in answer:
                    assert answer["text"] in note

            folder = Path(project("workspace")["folder"])
            file = folder / "tasks" / str(task_id) / "task.json"
            original = file.read_text()
            for count in (0, 1, 11):
                value = json.loads(original)
                value.update(agentStatus="pending", pendingRequestId="invalid-saved-request",
                             pendingRequest={"question": "Invalid saved request", "choices": choices(count)})
                temporary = file.with_suffix(".tmp")
                temporary.write_text(json.dumps(value))
                temporary.replace(file)
                result = project("snapshot")
                assert result["problems"], result
                assert not any(item["id"] == task_id for item in result["tasks"]), result
                temporary.write_text(original)
                temporary.replace(file)
        print("PASS: CLI/API reject 0/1/11; files reject invalid requests; the board preserves all three answer modes with 2/10 choices")


if __name__ == "__main__":
    main()
