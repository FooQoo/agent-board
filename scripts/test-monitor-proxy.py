#!/usr/bin/env python3
"""Exercise the real Agent Board remote listener through a temporary Caddy TLS proxy."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
CADDYFILE = ROOT / "examples" / "monitor" / "Caddyfile"


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


PNG = (
    b"\x89PNG\r\n\x1a\n"
    + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    + png_chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00"))
    + png_chunk(b"IEND", b"")
)


class CheckFailure(RuntimeError):
    pass


def check(condition: bool, message: str) -> None:
    if not condition:
        raise CheckFailure(message)


def free_port_in(ports: range, used: set[int]) -> int:
    for port in ports:
        if port in used:
            continue
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
        used.add(port)
        return port
    raise CheckFailure(f"No free port in {ports.start}-{ports.stop - 1}.")


def run_checked(args: list[str], *, env: dict[str, str], stdin: str | None = None) -> str:
    result = subprocess.run(
        args,
        cwd=ROOT,
        env=env,
        input=stdin,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        # Avoid printing command arguments or environment values that could contain credentials.
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        for key in ("BASIC_AUTH_USER", "BASIC_AUTH_HASH"):
            secret = env.get(key)
            if secret:
                detail = detail.replace(secret, "<redacted>")
        raise CheckFailure(f"Command failed ({Path(args[0]).name}): {detail}")
    return result.stdout


def static_check() -> None:
    config = CADDYFILE.read_text(encoding="utf-8")
    required = [
        "https://{$LAN_IP:missing-required-LAN_IP}:{$HTTPS_PORT:missing-required-HTTPS_PORT}",
        "bind {$LAN_IP:missing-required-LAN_IP}",
        "tls internal",
        "auto_https disable_redirects",
        "basic_auth",
        "{$BASIC_AUTH_USER:missing-required-BASIC_AUTH_USER} {$BASIC_AUTH_HASH:invalid-required-BASIC_AUTH_HASH}",
        "skip_install_trust",
        "reverse_proxy 127.0.0.1:{$REMOTE_PORT:missing-required-REMOTE_PORT}",
        "header_up -Authorization",
        "header_up -X-Forwarded-Host",
        "flush_interval -1",
    ]
    missing = [entry for entry in required if entry not in config]
    check(not missing, f"Caddyfile is missing required directives: {', '.join(missing)}")
    check("header_up Host" not in config, "The HTTP upstream must preserve the incoming Host for the remote guard.")
    check("/Users/" not in config and "/home/" not in config, "Caddyfile contains a machine-specific path.")
    print("Static Caddyfile checks passed. No Caddy server or proxy request was run.")


def request(
    opener: urllib.request.OpenerDirector,
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: float = 8,
) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with opener.open(req, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as response:
        return response.code, dict(response.headers.items()), response.read()


def wait_for_caddy(url: str, context: ssl.SSLContext, timeout: float = 15) -> None:
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context))
    deadline = time.monotonic() + timeout
    last_observation = "no request attempted"
    while time.monotonic() < deadline:
        try:
            status, _, _ = request(opener, url)
            if status == 401:
                return
            last_observation = f"HTTP {status}"
        except (OSError, urllib.error.URLError) as error:
            reason = getattr(error, "reason", error)
            last_observation = f"{type(reason).__name__}: {reason}"
            time.sleep(0.1)
    raise CheckFailure(f"Caddy did not return an unauthenticated HTTPS 401; last observation: {last_observation}.")


def stop_process(process: subprocess.Popen[str] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def assert_port_released(port: int) -> None:
    with socket.socket() as sock:
        if sock.connect_ex(("127.0.0.1", port)) == 0:
            raise CheckFailure(f"A listener remained on port {port} after cleanup.")


def run_browser_test(*, origin: str, username: str, password: str, project_id: str, env: dict[str, str]) -> None:
    """Exercise the authenticated HTTPS entry, monitor, and PC write path in Chromium."""
    browser_test = r'''
import { chromium, expect } from '@playwright/test';

const { CADDY_BROWSER_ORIGIN: origin, BASIC_AUTH_USER: username, BASIC_AUTH_PASSWORD: password, BROWSER_PROJECT_ID: projectId } = process.env;
const browser = await chromium.launch();
const apiResponses = [];
try {
  const context = await browser.newContext({
    httpCredentials: { username, password },
    // The companion Python checks explicitly trust this temporary CA and reject it when untrusted.
    ignoreHTTPSErrors: true,
    viewport: { width: 375, height: 640 },
  });
  const monitor = await context.newPage();
  await monitor.goto(`${origin}/`);
  await expect(monitor).toHaveURL(/\/monitor\/$/);
  await expect(monitor.getByRole('region', { name: 'Cards' })).toBeVisible();
  await expect(monitor.getByText('Proxy fixture')).toBeVisible();
  await expect(monitor.getByRole('button', { name: 'Add card', exact: true })).toHaveCount(0);
  const monitorUrl = monitor.url();
  await monitor.getByRole('article', { name: /Proxy fixture/ }).click();
  await expect(monitor.getByRole('dialog')).toHaveCount(0);
  await expect(monitor).toHaveURL(monitorUrl);

  const desktop = await context.newPage();
  desktop.on('response', async (response) => {
    if (response.url().includes('/api/') && response.request().method() !== 'GET') {
      apiResponses.push({ method: response.request().method(), url: response.url(), status: response.status(), body: await response.text().catch(() => '') });
    }
  });
  await desktop.setViewportSize({ width: 1280, height: 900 });
  await desktop.goto(`${origin}/`);
  await expect(desktop).toHaveURL(/\/board\/$/);
  await desktop.getByRole('region', { name: 'Doing' }).getByRole('button', { name: /Proxy fixture/ }).click();
  await expect(desktop.getByRole('complementary', { name: 'Card details' })).toContainText('Proxy fixture');
  await expect(desktop.getByRole('tabpanel', { name: 'Description' })).toBeVisible();
  await expect(desktop.getByRole('button', { name: 'Add card', exact: true })).toBeVisible();
  const createdResponsePromise = desktop.waitForResponse((response) => response.url().endsWith('/cards') && response.request().method() === 'POST');
  await desktop.getByRole('button', { name: 'Add card', exact: true }).click();
  const dialog = desktop.getByRole('dialog', { name: 'Add card' });
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Created from HTTPS browser');
  const description = dialog.getByRole('textbox', { name: 'Description (Markdown)' });
  await description.click();
  await description.evaluate((element, markdown) => {
    const data = new DataTransfer();
    data.setData('text/plain', markdown);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, '## 作業内容\n\nHTTPS browser write.\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Browser write\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  const createdResponse = await createdResponsePromise;
  expect(createdResponse.status()).toBe(201);
  const createdCardId = (await createdResponse.json()).card.id;
  const added = desktop.getByRole('region', { name: 'Todo' }).getByRole('button', { name: /Created from HTTPS browser/ });
  await expect(added).toBeVisible();
  const source = await added.boundingBox();
  const target = await desktop.getByRole('region', { name: 'Doing' }).boundingBox();
  if (!source || !target) throw new Error('Could not measure the browser move source and destination.');
  await desktop.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await desktop.mouse.down();
  await desktop.mouse.move(source.x + source.width / 2 + 24, source.y + source.height / 2, { steps: 4 });
  await desktop.mouse.move(target.x + 100, target.y + 100, { steps: 12 });
  await desktop.mouse.up();
  const move = desktop.getByRole('dialog');
  await expect(move).toContainText('Todo');
  await expect(move).toContainText('Doing');
  await move.getByLabel('Reason').fill('Move through the HTTPS browser test.');
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(desktop.getByRole('region', { name: 'Doing' }).getByRole('button', { name: /Created from HTTPS browser/ })).toBeVisible();
  const stateStatus = await desktop.evaluate(async ({ projectId, cardId }) => {
    const token = document.querySelector('meta[name="agboard-token"]')?.getAttribute('content');
    const response = await fetch(`/api/projects/${projectId}/cards/${cardId}/agent-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agboard-Token': token ?? '' },
      body: JSON.stringify({ agentStatus: 'running', reason: 'Show the browser task in the HTTPS monitor.' }),
    });
    return response.status;
  }, { projectId, cardId: createdCardId });
  expect(stateStatus).toBe(200);
  await expect(monitor.getByRole('article', { name: /Created from HTTPS browser/ })).toBeVisible();
  console.log('Chromium HTTPS checks passed: mobile entry, read-only monitor, desktop entry, guarded PC write, and monitor SSE update.');
} catch (error) {
  console.log(`Chromium API response diagnostics: ${JSON.stringify(apiResponses)}`);
  throw error;
} finally {
  await browser.close();
}
'''
    browser_env = env | {
        "CADDY_BROWSER_ORIGIN": origin,
        "BASIC_AUTH_USER": username,
        "BASIC_AUTH_PASSWORD": password,
        "BROWSER_PROJECT_ID": project_id,
    }
    result = subprocess.run(
        ["node", "--input-type=module", "-e", browser_test],
        cwd=ROOT / "e2e",
        env=browser_env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        detail = "\n".join(part for part in (result.stdout.strip(), result.stderr.strip()) if part) or f"exit {result.returncode}"
        for secret in (username, password):
            detail = detail.replace(secret, "<redacted>")
        raise CheckFailure(f"Chromium HTTPS check failed: {detail}")
    print(result.stdout.strip())


def run_proxy_test(caddy: str) -> None:
    with tempfile.TemporaryDirectory(prefix="agboard-monitor-proxy-") as temporary:
        temp = Path(temporary)
        data_root = temp / "agboard"
        data_root.mkdir()
        xdg_data = temp / "xdg-data"
        xdg_config = temp / "xdg-config"
        xdg_data.mkdir()
        xdg_config.mkdir()

        env = os.environ.copy()
        env.update(
            {
                "AGBOARD_HOME": str(data_root),
                "TZ": "UTC",
                "XDG_DATA_HOME": str(xdg_data),
                "XDG_CONFIG_HOME": str(xdg_config),
            }
        )
        version = run_checked([caddy, "version"], env=env).strip()
        version_match = re.search(r"v?(\d+)\.(\d+)\.(\d+)", version)
        check(version_match is not None, "Could not parse `caddy version` output.")
        version_tuple = tuple(int(part) for part in version_match.groups())
        check(version_tuple >= (2, 8, 0), "Caddy 2.8.0 or newer is required for the basic_auth directive.")

        used: set[int] = set()
        https_port = free_port_in(range(8030, 8040), used)
        remote_port = free_port_in(range(8040, 8050), used)
        origin = f"https://127.0.0.1:{https_port}"
        username = "proxy-test"
        password = "test-" + base64.urlsafe_b64encode(os.urandom(24)).decode("ascii").rstrip("=")
        password_hash = run_checked(
            [caddy, "hash-password", "--algorithm", "bcrypt", "--bcrypt-cost", "10"],
            env=env,
            stdin=password + "\n",
        ).strip()
        caddy_env = env | {
            "LAN_IP": "127.0.0.1",
            "HTTPS_PORT": str(https_port),
            "REMOTE_PORT": str(remote_port),
            "BASIC_AUTH_USER": username,
            "BASIC_AUTH_HASH": password_hash,
        }

        missing_env = env.copy()
        for key in ("LAN_IP", "HTTPS_PORT", "REMOTE_PORT", "BASIC_AUTH_USER", "BASIC_AUTH_HASH"):
            missing_env.pop(key, None)
        invalid = subprocess.run(
            [caddy, "validate", "--config", str(CADDYFILE), "--adapter", "caddyfile"],
            cwd=ROOT,
            env=missing_env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        check(invalid.returncode != 0, "Caddy unexpectedly accepted the configuration with required variables missing.")
        run_checked([caddy, "validate", "--config", str(CADDYFILE), "--adapter", "caddyfile"], env=caddy_env)

        build_env = env.copy()
        run_checked(["pnpm", "--dir", "web", "install", "--frozen-lockfile"], env=build_env)
        run_checked(["pnpm", "--dir", "web", "build"], env=build_env)
        run_checked(["cargo", "build", "--bin", "agboard"], env=build_env)
        agboard = ROOT / "target" / "debug" / "agboard"
        check(agboard.is_file(), "The Rust build did not produce target/debug/agboard.")

        def cli(*args: str) -> str:
            return run_checked([str(agboard), "--json", *args], env=build_env)

        project_result = json.loads(cli("project", "create", "Proxy test"))
        project = project_result["project"]
        project_id = project["id"]
        project_name = project["name"]
        card_result = json.loads(
            cli(
                "--project",
                project_name,
                "add",
                "Proxy fixture",
                "--assignee",
                "ai",
                "--actor",
                "ai",
            )
        )
        card_id = card_result["card"]["id"]
        cli("--project", project_name, "mv", str(card_id), "doing", "--actor", "ai", "--reason", "Seed monitor browser fixture")
        cli("--project", project_name, "state", str(card_id), "running", "--actor", "ai", "--reason", "Seed monitor browser fixture")
        image_path = temp / "fixture.png"
        image_path.write_bytes(PNG)
        attachment_result = json.loads(
            cli(
                "--project",
                project_name,
                "attachment",
                "add",
                str(card_id),
                "--file",
                str(image_path),
                "--actor",
                "ai",
            )
        )
        attachment_id = attachment_result["attachment"]["id"]

        board_process: subprocess.Popen[str] | None = None
        caddy_process: subprocess.Popen[str] | None = None
        caddy_log = temp / "caddy.log"
        cleanup_ports = [https_port, remote_port]
        try:
            board_process = subprocess.Popen(
                [
                    str(agboard),
                    "--json",
                    "serve",
                    "--port",
                    "0",
                    "--remote-port",
                    str(remote_port),
                    "--remote-origin",
                    origin,
                ],
                cwd=ROOT,
                env=build_env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            assert board_process.stdout is not None
            startup = board_process.stdout.readline().strip()
            check(bool(startup), "The real Agent Board server exited before reporting its bound ports.")
            startup_data = json.loads(startup)
            local_url = startup_data["url"]
            local_port = urlparse(local_url).port
            check(local_port is not None, "The local listener did not report its bound port.")
            cleanup_ports.append(local_port)
            check(startup_data["remoteUrl"] == f"http://127.0.0.1:{remote_port}/", "Unexpected remote listener URL.")
            serve_info = json.loads((data_root / "serve.json").read_text(encoding="utf-8"))
            check(serve_info.get("port") == local_port, "serve.json did not retain only the local PC listener port.")

            caddy_process = subprocess.Popen(
                [caddy, "run", "--config", str(CADDYFILE), "--adapter", "caddyfile"],
                cwd=ROOT,
                env=caddy_env,
                text=True,
                stdout=subprocess.DEVNULL,
                stderr=caddy_log.open("w"),
            )

            trust_file = xdg_data / "caddy" / "pki" / "authorities" / "local" / "root.crt"
            deadline = time.monotonic() + 15
            while not trust_file.is_file() and time.monotonic() < deadline:
                if caddy_process.poll() is not None:
                    raise CheckFailure("Caddy exited while creating its temporary internal CA.")
                time.sleep(0.1)
            check(trust_file.is_file(), "Caddy did not create the temporary public root certificate.")

            trusted_context = ssl.create_default_context(cafile=str(trust_file))
            # Wait for the listener to return its auth challenge before testing trust rejection.
            try:
                wait_for_caddy(origin + "/", trusted_context)
            except CheckFailure as error:
                logs = caddy_log.read_text(encoding="utf-8").strip()
                raise CheckFailure(f"{error} Caddy log: {logs or '<empty>'}.") from error
            untrusted = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()))
            try:
                request(untrusted, origin + "/")
            except urllib.error.URLError as error:
                reason = getattr(error, "reason", error)
                caddy_status = caddy_process.poll()
                caddy_error = ""
                if caddy_status is not None and caddy_process.stderr is not None:
                    caddy_error = caddy_process.stderr.read().strip()
                check(
                    isinstance(reason, ssl.SSLCertVerificationError),
                    f"Untrusted-certificate failure was {type(reason).__name__}: {reason}; "
                    f"Caddy exit={caddy_status}, stderr={caddy_error!r}.",
                )
            else:
                raise CheckFailure("The temporary Caddy CA was unexpectedly trusted by the system client.")

            auth_value = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
            authorized = urllib.request.build_opener(urllib.request.HTTPSHandler(context=trusted_context))
            unauthorized = urllib.request.build_opener(urllib.request.HTTPSHandler(context=trusted_context))
            wrong_auth = {"Authorization": "Basic " + base64.b64encode(b"proxy-test:wrong").decode("ascii")}

            protected_paths = [
                "/",
                "/board/",
                "/assets/app.js",
                "/monitor/",
                "/monitor/api/projects",
                f"/monitor/api/projects/{project_id}/cards/{card_id}/attachments/{attachment_id}",
                "/monitor/api/events",
            ]
            for path in protected_paths:
                status, _, _ = request(unauthorized, origin + path)
                check(status == 401, f"Unauthenticated {path} returned {status}, expected 401.")
            for method, path in [
                ("POST", f"/api/projects/{project_id}/cards"),
                ("DELETE", f"/api/projects/{project_id}/cards/{card_id}"),
            ]:
                status, _, _ = request(
                    unauthorized,
                    origin + path,
                    method=method,
                    headers={"Content-Type": "application/json"},
                    body=b"{}",
                )
                check(status == 401, f"Unauthenticated {method} {path} returned {status}, expected 401.")
            status, _, _ = request(authorized, origin + "/monitor/", headers={"Authorization": auth_value, **wrong_auth})
            check(status == 401, "Invalid Basic credentials were not rejected.")

            def get(path: str) -> tuple[int, dict[str, str], bytes]:
                return request(authorized, origin + path, headers={"Authorization": auth_value})

            status, _, entry = get("/")
            check(status == 200 and b"agboard-token" not in entry, "The protected entry page failed or exposed a session token.")
            status, _, board = get("/board/")
            check(status == 200, f"The protected PC board returned {status}.")
            remote_token_match = re.search(rb'<meta name="agboard-token" content="([^"]+)"', board)
            check(remote_token_match is not None, "The PC board did not include its remote token.")
            remote_token = remote_token_match.group(1).decode("ascii")
            local_status, _, local_page = request(authorized, local_url)
            check(local_status == 200, "The local PC listener did not respond for token comparison.")
            local_token_match = re.search(rb'<meta name="agboard-token" content="([^"]+)"', local_page)
            check(local_token_match is not None, "The local PC page did not include its session token.")
            check(remote_token != local_token_match.group(1).decode("ascii"), "Remote and local PC tokens were reused.")

            for path in ["/assets/app.js", "/assets/monitor/monitor.js"]:
                status, _, _ = get(path)
                check(status == 200, f"Protected asset {path} returned {status}.")
            status, _, monitor = get("/monitor/")
            check(status == 200 and b"agboard-token" not in monitor, "The monitor page failed or exposed a PC token.")
            status, _, projects = get("/monitor/api/projects")
            check(status == 200 and project_id.encode() in projects, "The monitor project list did not include the real fixture.")
            status, image_headers, image = get(
                f"/monitor/api/projects/{project_id}/cards/{card_id}/attachments/{attachment_id}"
            )
            check(status == 200 and image == PNG, "The owned image did not traverse the authenticated proxy unchanged.")
            check(image_headers.get("Content-Type", "").startswith("image/"), "The owned image had no image content type.")

            for method in ["POST", "PUT", "PATCH", "DELETE"]:
                status, _, _ = request(
                    authorized,
                    origin + f"/monitor/api/projects/{project_id}/board",
                    method=method,
                    headers={"Authorization": auth_value, "Content-Type": "application/json"},
                    body=b"{}",
                )
                check(status == 405, f"Monitor {method} returned {status}, expected 405.")

            board_path = f"/monitor/api/projects/{project_id}/board"
            status, _, initial_board = get(board_path)
            check(status == 200, "Could not read the monitor board before the write guard test.")
            write_url = origin + f"/api/projects/{project_id}/cards"
            payload = json.dumps(
                {
                    "title": "Created through HTTPS proxy",
                    "description": "## 作業内容\n\nproxy test\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Verify proxy\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n",
                    "assignee": "ai",
                }
            ).encode()
            write_headers = {
                "Authorization": auth_value,
                "Content-Type": "application/json",
                "Origin": origin,
                "Sec-Fetch-Site": "same-origin",
                "X-Agboard-Token": remote_token,
            }

            # Keep a real monitor SSE stream open while making the allowed PC write.
            sse_request = urllib.request.Request(
                origin + "/monitor/api/events", headers={"Authorization": auth_value}
            )
            with authorized.open(sse_request, timeout=10) as stream:
                ready = stream.readline() + stream.readline() + stream.readline()
                check(b"event: ready" in ready, "Monitor SSE did not send ready through the proxy.")
                status, _, created = request(
                    authorized,
                    write_url,
                    method="POST",
                    headers=write_headers,
                    body=payload,
                )
                check(status == 201, f"Correctly guarded PC write returned {status}: {created[:300]!r}")
                changed = stream.readline() + stream.readline() + stream.readline()
                check(b"event: changed" in changed, "SSE did not deliver the guarded write through the proxy.")

            status, _, accepted_board = get(board_path)
            check(status == 200, "Could not read the monitor board after the allowed PC write.")

            # A mismatched origin, token, or Host must fail and leave the board unchanged.
            for label, changed_headers in [
                ("Origin", {"Origin": "https://other.example"}),
                ("token", {"X-Agboard-Token": "invalid"}),
            ]:
                invalid_headers = write_headers | changed_headers
                status, _, _ = request(authorized, write_url, method="POST", headers=invalid_headers, body=payload)
                check(status == 403, f"Invalid {label} returned {status}, expected 403.")

            direct_remote = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            status, _, _ = request(
                direct_remote,
                f"http://127.0.0.1:{remote_port}/api/projects/{project_id}/cards",
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Origin": origin,
                    "Sec-Fetch-Site": "same-origin",
                    "X-Agboard-Token": remote_token,
                    "Host": "other.example",
                },
                body=payload,
            )
            check(status == 403, f"A forged Host at the remote listener returned {status}, expected 403.")

            status, host_headers, host_body = request(
                authorized,
                write_url,
                method="POST",
                headers=write_headers | {"Host": "other.example"},
                body=payload,
            )
            check(
                status == 403 or (status == 200 and not host_body and host_headers.get("Server") == "Caddy"),
                f"Caddy did not reject an unmatched Host as 403 or short-circuit it with an empty response: "
                f"response={host_body[:240]!r}, headers={host_headers!r}.",
            )
            status, _, final_board = get(board_path)
            check(status == 200, "Could not read the monitor board after guard rejection tests.")
            check(accepted_board != initial_board, "The allowed PC write was not visible in the monitor snapshot.")
            check(final_board == accepted_board, "A rejected guard test changed the monitor snapshot.")
            check(b"Created through HTTPS proxy" in final_board, "The monitor snapshot missed the accepted write.")

            run_browser_test(origin=origin, username=username, password=password, project_id=project_id, env=build_env)

        finally:
            stop_process(caddy_process)
            stop_process(board_process)
            for port in cleanup_ports:
                assert_port_released(port)
            check(not (data_root / "serve.json").exists(), "Agent Board did not remove its temporary serve.json on shutdown.")

        print(f"Caddy {version}: temporary TLS trust, Basic auth, remote guard, monitor reads, image, SSE, and cleanup checks passed.")
        print("No Tailscale client, tailnet, device certificate store, or persistent Caddy data was used.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--static-only",
        action="store_true",
        help="Check Caddyfile requirements without starting Caddy, Agent Board, or network requests.",
    )
    args = parser.parse_args()
    try:
        static_check()
        if args.static_only:
            return 0
        caddy = shutil.which("caddy")
        if not caddy:
            raise CheckFailure("caddy is not on PATH; no proxy or TLS test was run. Install Caddy 2.8+ to run the full test.")
        run_proxy_test(caddy)
        return 0
    except (CheckFailure, OSError, KeyError, ValueError, subprocess.SubprocessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
