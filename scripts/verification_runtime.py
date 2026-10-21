"""Small process helpers for local verification scripts, outside CI."""

from contextlib import contextmanager
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
from urllib.request import urlopen


@contextmanager
def serve(binary, home, port):
    """Start an isolated board and stop the whole process group."""
    if port == 7420:
        raise ValueError("Port 7420 is reserved for normal use")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", port))
    env = {**os.environ, "AGBOARD_HOME": str(home), "TZ": "UTC"}
    with (Path(home) / "serve.log").open("w+") as log:
        process = subprocess.Popen(
            [str(binary), "serve", "--port", str(port)],
            env=env, cwd=home, stdout=log, stderr=log, start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 20
            while True:
                if process.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(log.read())
                try:
                    with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1):
                        break
                except OSError:
                    if time.monotonic() > deadline:
                        raise TimeoutError("Isolated serve did not start")
                    time.sleep(0.1)
            yield process
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
