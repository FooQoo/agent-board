"""Run a command on a pseudo-terminal, wait for its "[y/N] " prompt, and answer it.

Usage: pty_answer.py <answer> <command> [args...]

The command gets the terminal as stdin, stdout and stderr, so agboard treats the
run as interactive. Everything the command printed is written to stdout and
the command's exit code becomes this script's exit code. Gives up after 20 s.
"""
import os
import pty
import select
import subprocess
import sys
import time

answer, command = sys.argv[1], sys.argv[2:]
master, slave = pty.openpty()
child = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)

deadline = time.monotonic() + 20
seen = b""
answered = False
while time.monotonic() < deadline:
    ready, _, _ = select.select([master], [], [], 0.1)
    if ready:
        try:
            chunk = os.read(master, 4096)
        except OSError:
            break
        if not chunk:
            break
        seen += chunk
        if not answered and b"[y/N] " in seen:
            os.write(master, (answer + "\n").encode())
            answered = True
    elif child.poll() is not None:
        break

if child.poll() is None:
    child.kill()
    child.wait()
    sys.stdout.write(seen.decode(errors="replace"))
    sys.stderr.write("timed out waiting for the command\n")
    sys.exit(124)

sys.stdout.write(seen.decode(errors="replace"))
sys.exit(child.returncode)
