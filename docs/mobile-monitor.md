# Mobile monitor

[README](../README.md) · [Usage guide](usage.md)

The monitor groups cards into Todo, Doing, and Done. Doing cards show an Idle, Running, or Pending badge; pending cards also show the waiting reason. Todo and Done cards have no status badge. Cards do not open details when tapped or clicked. Use the PC board to read card details and update work.

Run the commands below from the repository root after [installing Agent Board](usage.md#installation-and-updates).

## Remote access

`agboard serve` keeps the ordinary PC listener on loopback. Add a separate remote listener only when you put it behind a trusted HTTPS proxy:

```sh
agboard serve --port 7420 --remote-port 8040 \
  --remote-origin https://192.168.1.20:8443 \
  --remote-origin https://my-mac.example-tailnet.ts.net
```

Use only the origins you will actually publish. The remote port is a second loopback listener for the proxy; never proxy the local PC port. Opening the common URL selects the monitor below 768 CSS pixels and the PC board at wider sizes. Direct `/monitor/` and `/board/` URLs remain available regardless of width. The PC board retains its remote write guard, while the monitor API is read-only.

## LAN with Caddy

Install Caddy 2.8 or newer from the [official Caddy downloads and installation guide](https://caddyserver.com/docs/install). The standard build is enough. The Caddyfile at [`examples/monitor/Caddyfile`](../examples/monitor/Caddyfile) binds to the chosen LAN IP, uses Caddy's internal HTTPS authority, and requires [Basic authentication](https://caddyserver.com/docs/caddyfile/directives/basic_auth) on every route. It forwards only to the dedicated remote port, preserves the browser's Host and Origin for Agent Board's guard, strips Authorization and `X-Forwarded-Host`, and [flushes SSE promptly](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming). The example disables Caddy's admin API and automatic root-certificate installation; the local test reads the temporary public root directly.

Set the values for your machine and create a password hash. Keep the plaintext password out of shell history and the Caddyfile:

```sh
export LAN_IP=192.168.1.20
export HTTPS_PORT=8443
export REMOTE_PORT=8040
export BASIC_AUTH_USER=board-reader
export BASIC_AUTH_HASH="$(caddy hash-password)"
```

In one terminal, start Agent Board with the exact public HTTPS origin:

```sh
agboard serve --port 7420 --remote-port "$REMOTE_PORT" \
  --remote-origin "https://${LAN_IP}:${HTTPS_PORT}"
```

In another terminal, validate and run the proxy in the foreground:

```sh
caddy validate --config examples/monitor/Caddyfile --adapter caddyfile
caddy run --config examples/monitor/Caddyfile --adapter caddyfile
```

Open `https://<LAN_IP>:<HTTPS_PORT>/` on a device on the same trusted LAN and enter the Basic-auth credentials. Caddy's `tls internal` certificate is signed by its local CA, which phones do not trust by default. The public root certificate is `<Caddy data directory>/pki/authorities/local/root.crt` (for example, `$XDG_DATA_HOME/caddy/pki/authorities/local/root.crt` when `XDG_DATA_HOME` is set; see [Caddy's data-directory conventions](https://caddyserver.com/docs/conventions#data-directory)). Copy only that public certificate to the phone through a trusted channel and follow the phone OS's steps to trust it. Never copy or distribute Caddy's CA private key. Caddy's data directory is persistent; keep it private and back it up. Do not enable router port forwarding or expose this listener to the public Internet.

Stop both foreground processes with Ctrl+C. When the computer sleeps or either process stops, the remote service is unavailable until Agent Board and Caddy are running again.

## Tailscale Serve

Install the [Tailscale standalone app for your OS](https://tailscale.com/download) and use Tailscale CLI 1.52 or newer; the [current Serve CLI syntax](https://tailscale.com/docs/reference/tailscale-cli/serve) changed in 1.52. Add the computer and phone to your existing tailnet. In the tailnet admin controls, restrict access to your own account and the specific devices that should reach this board. Serve requires HTTPS certificates to be enabled for the tailnet; invoking Serve may ask you to approve that change. Review the consent page before accepting. [Tailnet access rules apply to Serve](https://tailscale.com/docs/features/tailscale-serve).

Start Agent Board on a dedicated remote port, then start Serve for that loopback port:

```sh
agboard serve --port 7420 --remote-port 8040 \
  --remote-origin https://<origin-shown-by-tailscale>
tailscale serve --bg http://127.0.0.1:8040
tailscale serve status
tailscale funnel status
```

Use the exact HTTPS origin shown by `tailscale serve status` as `--remote-origin` before starting Agent Board. Confirm Serve is active only within your tailnet and Funnel is not exposing the service publicly. Do not add a custom proxy that rewrites Host or Origin. Tailscale access rules apply to Serve, and Agent Board still checks the remote PC write token and same-origin request headers.

Stop Agent Board with Ctrl+C. To remove only this Serve route, use `tailscale serve --bg http://127.0.0.1:8040 off`; inspect `tailscale serve status` before changing an existing shared Serve configuration. The background Serve setting can resume after a reboot, but the board itself remains unavailable while the computer sleeps or its server is stopped.

## Verify the proxy setup

The local proxy test uses a real Caddy process, the real Agent Board server, and a temporary CA. Run `python3 scripts/test-monitor-proxy.py` after installing Caddy 2.8+ and the Rust, Node.js, and pnpm build tools. It uses temporary data/config/certificate directories, fake Basic-auth credentials, HTTPS ports 8030–8039, and Agent Board remote ports 8040–8049. `python3 scripts/test-monitor-proxy.py --static-only` checks the Caddyfile without starting services. This local test does not verify a real LAN, phone certificate trust, or a Tailscale tailnet.
