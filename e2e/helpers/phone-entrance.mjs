// The phone monitor entrance for browser tests and sample-media scripts.
//
// It starts the dedicated ngrok monitor backend on loopback (the Rust test
// `monitor_phone_serve`, whose fake connector opens the "tunnel" without any
// network) over a data area the caller filled, and puts a small proxy in front
// of it. The proxy stands in for the ngrok Edge, which runs without a Traffic
// Policy: it names the public Host on every request and the public Origin on
// writes, and drops the forwarding and identity headers a client could write. The app asks for the 4-digit passcode of the run
// and issues the session cookie and the CSRF token itself, exactly as it does
// behind the real Edge. The backend announces the passcode the way the PC would
// show it; `passcode` and `unlockPage` hand it to a test.
//
// NOT exercised here: how a real Edge forwards a request, and any real ngrok
// connection. A pass shows what the application side admits
// and refuses, not that an Edge enforces it.
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let executable;

/** Builds the backend test binary once per process and returns its path. */
export function buildPhoneBackend() {
  if (executable) return executable;
  const result = spawnSync(
    'cargo',
    ['test', '--test', 'monitor_phone_serve', '--no-run', '--message-format=json'],
    { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`cargo test --no-run failed: ${result.stderr}`);
  for (const line of result.stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    const message = JSON.parse(line);
    if (message.executable && message.target?.name === 'monitor_phone_serve') {
      executable = message.executable;
    }
  }
  if (!executable) throw new Error('the monitor_phone_serve test binary was not found');
  return executable;
}

// Headers a real Edge would never pass on as the caller's own.
const EDGE_OWNED = /^(ngrok-|x-forwarded-|forwarded$)/i;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

/**
 * Starts the backend over `home` and the Edge stand-in in front of it.
 *
 * `phoneOrigin` is what the phone's browser opens (`<phoneOrigin>/monitor/`);
 * `pcOrigin` is the backend's own PC entrance on loopback, with the normal board.
 */
export async function startPhoneEntrance(home, { timeoutMs = 120_000 } = {}) {
  const binary = buildPhoneBackend();
  const target = { addr: '', passcode: '', host: '', origin: '' };
  const lines = [];
  const waiters = [];
  let stderr = '';
  let child;
  let pcOrigin = '';
  let projectId = '';

  const proxy = http.createServer((req, res) => {
    const [hostname, port] = target.addr.split(':');
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!EDGE_OWNED.test(name)) headers[name] = value;
    }
    headers.host = target.host;
    if (headers.origin !== undefined) headers.origin = target.origin;
    const upstream = http.request(
      { hostname, port: Number(port), path: req.url, method: req.method, headers },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
        res.on('close', () => reply.destroy());
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
    res.on('close', () => upstream.destroy());
  });
  const proxyPort = await listen(proxy);
  const phoneOrigin = `http://127.0.0.1:${proxyPort}`;

  function waitFor(prefix, since) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${prefix} line; stderr: ${stderr}`)), timeoutMs);
      const check = () => {
        if (child.exitCode !== null) {
          clearTimeout(timer);
          reject(new Error(`the monitor backend exited (${child.exitCode}); stderr: ${stderr}`));
          return true;
        }
        const found = lines.slice(since).find((line) => line.startsWith(prefix));
        if (found === undefined) return false;
        clearTimeout(timer);
        resolve(found.slice(prefix.length).trim());
        return true;
      };
      if (!check()) waiters.push(check);
    });
  }

  function take(ready) {
    const info = JSON.parse(ready);
    Object.assign(target, info);
  }

  async function launch() {
    lines.length = 0;
    waiters.length = 0;
    child = spawn(binary, ['--ignored', '--nocapture'], {
      cwd: repo,
      env: { ...process.env, AGBOARD_PHONE_HOME: home, TZ: 'UTC' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let partial = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      partial += chunk;
      const parts = partial.split('\n');
      partial = parts.pop() ?? '';
      lines.push(...parts);
      for (const check of [...waiters]) if (check()) waiters.splice(waiters.indexOf(check), 1);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('exit', () => { for (const check of [...waiters]) check(); });
    pcOrigin = await waitFor('LOCAL', 0);
    take(await waitFor('READY', 0));
    projectId = lines.find((line) => line.startsWith('PROJECT '))?.slice(8).trim() ?? '';
  }

  async function quit() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.stdin.write('quit\n');
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGTERM'), 5_000);
    await exited;
    clearTimeout(timer);
  }

  async function unlockPage(page) {
    const field = page.locator('#monitor-passcode');
    await field.fill(target.passcode);
    await field.press('Enter');
  }

  await launch();

  return {
    phoneOrigin,
    get pcOrigin() { return pcOrigin; },
    /** The project of the built-in fixture; empty when the caller supplied the data area. */
    get projectId() { return projectId; },
    /** The public host, passcode and loopback address the Edge stand-in forwards to. */
    get target() { return { ...target }; },
    /** The passcode of the run, as the PC shows it. It changes whenever the tunnel is replaced. */
    get passcode() { return target.passcode; },
    /** Type the passcode into the phone page that is asking for it and send it. */
    unlockPage,
    /** Open a phone monitor URL and enter the passcode, as a person with the PC beside them would. */
    async open(page, url) {
      const response = await page.goto(url);
      await unlockPage(page);
      return response;
    },
    /** Replace the tunnel: every phone session ends, and a new passcode is issued. */
    async rotate() {
      const since = lines.length;
      child.stdin.write('rotate\n');
      take(await waitFor('READY', since));
    },
    /** Stop the tunnel; the backend closes and the phone can read nothing. */
    async stopTunnel() {
      const since = lines.length;
      child.stdin.write('stop\n');
      await waitFor('STOPPED', since);
    },
    /** Stop the whole backend and start it again over the same data area. */
    async restart() {
      await quit();
      await launch();
    },
    async stop() {
      await quit();
      await new Promise((resolve) => proxy.close(resolve));
      proxy.closeAllConnections?.();
    },
  };
}
