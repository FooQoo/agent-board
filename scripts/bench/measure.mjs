#!/usr/bin/env node
// Measures the PC board and the phone monitor on the benchmark data area from gen-fixture.mjs.
//
// For each target, every run starts from a fresh copy of the fixture, so the status change of one run
// does not reach the next. Each measured item is repeated --runs times; the result keeps every value,
// the median, and the range. Numbers are not judged against a threshold: they are recorded for comparison.
//
// Usage:
//   node scripts/bench/measure.mjs [--bin <agboard>] [--port 9210] [--runs 3]
//     [--target pc|monitor|both] [--fixture <dir>] [--out-dir <dir>] [--commit <sha>]
//
// --bin       the agboard binary used for the PC board and for the CLI status change (default: target/debug/agboard)
// --port      the loopback port of the PC server; must be within 9210-9219
// --fixture   a directory from gen-fixture.mjs; when omitted, a fixture is generated into a temporary directory
// --out-dir   where pc.json and monitor.json are written (default: scripts/bench/results)
//
// The monitor uses the phone entrance from e2e/helpers. Its backend is the monitor_phone_serve test binary
// of this repository and binds OS-assigned loopback ports, so it runs outside 9210-9219.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_SEED, digest, generateFixture } from './gen-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const requireFromE2e = createRequire(path.join(repo, 'e2e', 'package.json'));
const { chromium } = requireFromE2e('@playwright/test');
const playwrightVersion = requireFromE2e('@playwright/test/package.json').version;
const { startPhoneEntrance } = await import(pathToFileURL(path.join(repo, 'e2e', 'helpers', 'phone-entrance.mjs')).href);

const PORT_MIN = 9210;
const PORT_MAX = 9219;
// The final measurement runs in the range of its own run.
const PORT_ALT_MIN = 9320;
const PORT_ALT_MAX = 9329;
const PC_VIEWPORT = { width: 1280, height: 900 };
const PHONE_VIEWPORT = { width: 390, height: 844 };
const PROJECT = 'Bench';
const QUIET_MS = 1000;
const LONGTASK_SCRIPT = `(() => {
  window.__longtasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longtasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  } catch (error) {
    window.__longtasks = null;
  }
})();`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = { bin: path.join(repo, 'target', 'debug', 'agboard'), port: 9210, runs: 3, target: 'both', seed: DEFAULT_SEED };
  for (let i = 0; i < argv.length; i++) {
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${argv[i - 1]} needs a value`);
      return next;
    };
    switch (argv[i]) {
      case '--bin': args.bin = path.resolve(value()); break;
      case '--port': args.port = Number(value()); break;
      case '--runs': args.runs = Number(value()); break;
      case '--target': args.target = value(); break;
      case '--fixture': args.fixture = path.resolve(value()); break;
      case '--out-dir': args.outDir = path.resolve(value()); break;
      case '--commit': args.commit = value(); break;
      case '--seed': args.seed = Number(value()); break;
      default: throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  const inRange = (min, max) => args.port >= min && args.port <= max;
  if (!Number.isInteger(args.port) || !(inRange(PORT_MIN, PORT_MAX) || inRange(PORT_ALT_MIN, PORT_ALT_MAX))) {
    throw new Error(`--port must be within ${PORT_MIN}-${PORT_MAX} or ${PORT_ALT_MIN}-${PORT_ALT_MAX}`);
  }
  if (!['pc', 'monitor', 'both'].includes(args.target)) throw new Error('--target must be pc, monitor, or both');
  args.outDir ??= path.join(here, 'results');
  return args;
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(true));
  });
}

function agboardEnv(home) {
  return { ...process.env, AGBOARD_HOME: home, TZ: 'UTC' };
}

function agboardJson(bin, home, args) {
  const result = spawnSync(bin, args, { cwd: home, env: agboardEnv(home), encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`agboard ${args.join(' ')} exited ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function projectIdOf(bin, home) {
  const found = agboardJson(bin, home, ['project', 'ls', '--json']).projects.find((project) => project.name === PROJECT);
  if (!found) throw new Error(`project ${PROJECT} is missing`);
  return found.id;
}

/** The fixture must read back with no file problems and the documented counts, or the run is meaningless. */
function checkFixture(bin, fixture) {
  const copy = mkdtempSync(path.join(os.tmpdir(), 'agboard-bench-check-'));
  try {
    cpSync(fixture, copy, { recursive: true });
    const snapshot = agboardJson(bin, copy, ['--project', PROJECT, 'snapshot', '--json']);
    const checks = {
      tasks: snapshot.tasks.length,
      epics: snapshot.epics.length,
      problems: snapshot.problems.length,
      longestBody: Math.max(...snapshot.tasks.map((task) => task.body.length)),
      historyOfHeaviest: snapshot.tasks.find((task) => task.id === 6)?.history.length ?? 0,
    };
    if (checks.tasks !== 300 || checks.epics !== 10 || checks.problems !== 0 || checks.longestBody !== 50000) {
      throw new Error(`fixture check failed: ${JSON.stringify(checks)}`);
    }
    return checks;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** Traffic seen by one page, from the DevTools Network domain. Streams are counted but their bytes are not. */
function categorize(url) {
  if (url.startsWith('data:')) return 'inline';
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 'other';
  }
  if (pathname.endsWith('/api/events')) return 'stream';
  if (pathname.includes('/api/')) return 'api';
  if (pathname.includes('/assets/') || /\.(js|css|png|svg|ico|woff2?|ttf)$/.test(pathname)) return 'static';
  return 'document';
}

/** The route of a URL: its path with 32-digit hexadecimal IDs and numeric segments replaced. */
function routeOf(url) {
  if (url.startsWith('data:')) return 'data: (inline)';
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 'other';
  }
  return pathname
    .split('/')
    .map((part) => part.replace(/[0-9a-f]{32}/g, ':id').replace(/^\d+$/, ':n'))
    .join('/');
}

class NetLog {
  constructor(cdp) {
    this.responses = [];
    this.finished = [];
    this.urls = new Map();
    cdp.on('Network.responseReceived', (event) => {
      this.urls.set(event.requestId, event.response.url);
      this.responses.push({ category: categorize(event.response.url), route: routeOf(event.response.url) });
    });
    cdp.on('Network.loadingFinished', (event) => {
      const url = this.urls.get(event.requestId) ?? '';
      this.finished.push({ category: categorize(url), route: routeOf(url), bytes: event.encodedDataLength });
    });
  }

  mark() {
    return { responses: this.responses.length, finished: this.finished.length, at: Date.now() };
  }

  /** Requests and bytes after `mark`: a flat record of numbers for the summary, and the same per route. */
  since(mark, prefix) {
    const routes = {};
    const entry = (key) => {
      routes[key] ??= { requests: 0, bytes: 0 };
      return routes[key];
    };
    for (const response of this.responses.slice(mark.responses)) entry(response.route).requests += 1;
    for (const finished of this.finished.slice(mark.finished)) entry(finished.route).bytes += finished.bytes;
    const record = {};
    const categories = ['document', 'api', 'static', 'stream', 'inline'];
    for (const category of categories) {
      record[`${prefix}.requests.${category}`] = this.responses.slice(mark.responses).filter((r) => r.category === category).length;
      record[`${prefix}.bytes.${category}`] = this.finished.slice(mark.finished)
        .filter((f) => f.category === category)
        .reduce((sum, f) => sum + f.bytes, 0);
    }
    record[`${prefix}.requests.total`] = categories.reduce((sum, c) => sum + record[`${prefix}.requests.${c}`], 0);
    record[`${prefix}.bytes.total`] = categories.reduce((sum, c) => sum + record[`${prefix}.bytes.${c}`], 0);
    return { metrics: record, routes };
  }

  count() {
    return this.responses.length + this.finished.length;
  }
}

/** Waits until an API response has started after `mark`, or returns null after `maxMs`. The live update can arrive seconds after the change. */
async function waitForApi(log, mark, maxMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (log.responses.slice(mark.responses).some((response) => response.category === 'api')) return Date.now() - start;
    await sleep(100);
  }
  // The page holds automatic updates while a card is open, so no request may follow: that is a result, not a failure.
  return null;
}

/** Waits until no response has started or finished for QUIET_MS, or until maxMs has passed. */
async function waitQuiet(log, maxMs = 20_000) {
  const start = Date.now();
  let seen = log.count();
  let quietSince = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(100);
    if (log.count() !== seen) {
      seen = log.count();
      quietSince = Date.now();
    }
    if (Date.now() - quietSince >= QUIET_MS) return;
  }
}

async function heapUsed(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? null;
}

async function longtasks(page) {
  return page.evaluate(() => {
    const list = window.__longtasks;
    if (!list) return { count: null, totalMs: null };
    return { count: list.length, totalMs: list.reduce((sum, value) => sum + value, 0) };
  });
}

/**
 * One PC run: first display, the heaviest card (#6, with 50,000 characters, 10 images, and 7 diagrams),
 * and a status change of card #1 made from the CLI while the board is open.
 */
async function runPc({ browser, bin, fixture, port, scratch, index }) {
  const home = path.join(scratch, `pc-${index}`);
  cpSync(fixture, home, { recursive: true });
  const projectId = projectIdOf(bin, home);
  const serve = spawn(bin, ['serve', '--port', String(port)], { cwd: home, env: agboardEnv(home), stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  serve.stderr.on('data', (chunk) => { stderr += chunk; });
  const context = await browser.newContext({ viewport: PC_VIEWPORT, locale: 'en-US', timezoneId: 'UTC' });
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, serve, () => stderr);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Performance.enable');
    await page.addInitScript(LONGTASK_SCRIPT);
    const log = new NetLog(cdp);

    const loadMark = log.mark();
    const started = Date.now();
    await page.goto(`http://127.0.0.1:${port}/?project=${projectId}`);
    await page.getByRole('button', { name: /^#1(?!\d)/ }).first().waitFor({ state: 'visible' });
    const firstVisibleMs = Date.now() - started;
    await waitQuiet(log);
    const load = log.since(loadMark, 'load');

    const heavyMark = log.mark();
    const heavyStarted = Date.now();
    await page.getByRole('button', { name: /^#6(?!\d)/ }).first().click();
    await page.getByText('Heavy 6 section 1', { exact: true }).first().waitFor({ state: 'visible' });
    const heavyOpenMs = Date.now() - heavyStarted;
    await waitQuiet(log);
    const heavy = log.since(heavyMark, 'heavy');
    const domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);
    const jsHeapUsedBytes = await heapUsed(cdp);

    const statusMark = log.mark();
    const statusStarted = Date.now();
    const change = spawnSync(bin, ['--project', PROJECT, 'mv', '1', 'doing', '--actor', 'human', '--reason', 'Benchmark status change'], {
      cwd: home,
      env: agboardEnv(home),
      encoding: 'utf8',
    });
    if (change.status !== 0) throw new Error(`status change failed: ${change.stderr}`);
    const statusDetectedMs = await waitForApi(log, statusMark);
    await waitQuiet(log);
    const statusMs = Date.now() - statusStarted;
    const status = log.since(statusMark, 'status');

    const tasks = await longtasks(page);
    const metrics = {
      firstVisibleMs,
      ...load.metrics,
      heavyOpenMs,
      ...heavy.metrics,
      domNodes,
      jsHeapUsedBytes,
      longtaskCount: tasks.count,
      longtaskTotalMs: tasks.totalMs,
      statusDetectedMs,
      statusMs,
      ...status.metrics,
    };
    const routes = { load: load.routes, heavy: heavy.routes, status: status.routes };
    return { index, metrics, routes, pageErrors: pageErrors.length };
  } finally {
    await context.close();
    await stopProcess(serve);
    await waitForPortFree(port);
    rmSync(home, { recursive: true, force: true });
  }
}

/** One monitor run: the same steps as the PC run, on the phone monitor through the phone entrance. */
async function runMonitor({ browser, bin, fixture, scratch, index }) {
  const home = path.join(scratch, `monitor-${index}`);
  cpSync(fixture, home, { recursive: true });
  const projectId = projectIdOf(bin, home);
  const entrance = await startPhoneEntrance(home, { warning: false });
  const context = await browser.newContext({ viewport: PHONE_VIEWPORT, locale: 'en-US', timezoneId: 'UTC' });
  try {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Performance.enable');
    await page.addInitScript(LONGTASK_SCRIPT);
    const log = new NetLog(cdp);

    const loadMark = log.mark();
    const started = Date.now();
    await page.goto(`${entrance.phoneOrigin}/monitor/?project=${projectId}`);
    await entrance.unlockPage(page);
    await page.getByRole('article', { name: /Bench task 001/ }).first().waitFor({ state: 'visible' });
    const firstVisibleMs = Date.now() - started;
    await waitQuiet(log);
    const load = log.since(loadMark, 'load');

    const heavyMark = log.mark();
    const heavyStarted = Date.now();
    await page.getByRole('article', { name: /Bench heavy task 6/ }).first().getByRole('button', { name: 'Bench heavy task 6', exact: true }).click();
    await page.getByText('Heavy 6 section 1', { exact: true }).first().waitFor({ state: 'visible' });
    const heavyOpenMs = Date.now() - heavyStarted;
    await waitQuiet(log);
    const heavy = log.since(heavyMark, 'heavy');
    const domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);
    const jsHeapUsedBytes = await heapUsed(cdp);

    const statusMark = log.mark();
    const statusStarted = Date.now();
    const change = spawnSync(bin, ['--project', PROJECT, 'mv', '1', 'doing', '--actor', 'human', '--reason', 'Benchmark status change'], {
      cwd: home,
      env: agboardEnv(home),
      encoding: 'utf8',
    });
    if (change.status !== 0) throw new Error(`status change failed: ${change.stderr}`);
    const statusDetectedMs = await waitForApi(log, statusMark);
    await waitQuiet(log);
    const statusMs = Date.now() - statusStarted;
    const status = log.since(statusMark, 'status');

    const tasks = await longtasks(page);
    const metrics = {
      firstVisibleMs,
      ...load.metrics,
      heavyOpenMs,
      ...heavy.metrics,
      domNodes,
      jsHeapUsedBytes,
      longtaskCount: tasks.count,
      longtaskTotalMs: tasks.totalMs,
      statusDetectedMs,
      statusMs,
      ...status.metrics,
    };
    const routes = { load: load.routes, heavy: heavy.routes, status: status.routes };
    return { index, metrics, routes, pageErrors: pageErrors.length };
  } finally {
    await context.close();
    await entrance.stop();
    rmSync(home, { recursive: true, force: true });
  }
}

async function waitForHttp(url, child, stderrText) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`serve exited early: ${stderrText()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is not listening yet.
    }
    await sleep(200);
  }
  throw new Error(`serve did not answer at ${url}: ${stderrText()}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}

async function waitForPortFree(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return true;
    await sleep(200);
  }
  throw new Error(`port ${port} is still in use after the server stopped`);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Per phase and route: requests and bytes of each run, the median, and whether the runs agree. */
function summarizeRoutes(runs) {
  const summary = {};
  for (const phase of ['load', 'heavy', 'status']) {
    const keys = new Set(runs.flatMap((run) => Object.keys(run.routes[phase])));
    summary[phase] = {};
    for (const key of [...keys].sort()) {
      const pick = (field) => runs.map((run) => run.routes[phase][key]?.[field] ?? 0);
      const requests = pick('requests');
      const bytes = pick('bytes');
      summary[phase][key] = {
        requests: { values: requests, median: median(requests), identical: new Set(requests).size === 1 },
        bytes: { values: bytes, median: median(bytes), identical: new Set(bytes).size === 1 },
      };
    }
  }
  return summary;
}

/** For each numeric metric: every value, the median, and the range. `identical` tells whether the runs agree. */
function summarize(runs) {
  const summary = {};
  for (const key of Object.keys(runs[0].metrics)) {
    const values = runs.map((run) => run.metrics[key]);
    if (values.some((value) => typeof value !== 'number')) continue;
    summary[key] = {
      values,
      median: median(values),
      min: Math.min(...values),
      max: Math.max(...values),
      identical: new Set(values).size === 1,
    };
  }
  return summary;
}

function environmentInfo(browser, commit, bin, fixture) {
  let osVersion = `${os.type()} ${os.release()} ${os.arch()}`;
  try {
    osVersion = `macOS ${execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()} (${os.arch()})`;
  } catch {
    // Not macOS: keep the kernel description.
  }
  return {
    commit,
    binary: path.relative(repo, bin) || path.basename(bin),
    binaryBuild: 'cargo build (dev profile)',
    os: osVersion,
    chromium: browser.version(),
    playwright: playwrightVersion,
    node: process.version,
    timezone: 'UTC',
    locale: 'en-US',
    fixture: { seed: fixture.seed, files: fixture.files, bytes: fixture.bytes, digest: fixture.digest, attachments: fixture.attachmentCount },
  };
}

function gitShortHead() {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'agboard-bench-'));
  const commit = args.commit ?? gitShortHead();
  let fixture;
  if (args.fixture) {
    const info = digest(args.fixture);
    fixture = { seed: args.seed, ...checkFixture(args.bin, args.fixture), files: info.files, bytes: info.bytes, digest: info.digest, attachmentCount: null };
  } else {
    const generated = generateFixture(path.join(scratch, 'fixture'), args.seed);
    fixture = { seed: args.seed, ...checkFixture(args.bin, generated.out), files: generated.files, bytes: generated.bytes, digest: generated.digest, attachmentCount: generated.attachmentCount };
    args.fixture = generated.out;
  }
  const browser = await chromium.launch({ headless: true });
  const env = environmentInfo(browser, commit, args.bin, fixture);
  mkdirSync(args.outDir, { recursive: true });
  try {
    for (const target of args.target === 'both' ? ['pc', 'monitor'] : [args.target]) {
      const runs = [];
      for (let index = 1; index <= args.runs; index++) {
        const run = target === 'pc'
          ? await runPc({ browser, bin: args.bin, fixture: args.fixture, port: args.port, scratch, index })
          : await runMonitor({ browser, bin: args.bin, fixture: args.fixture, scratch, index });
        runs.push(run);
        process.stderr.write(`${target} run ${index} done\n`);
      }
      const result = {
        schemaVersion: 1,
        target,
        startedAt,
        finishedAt: new Date().toISOString(),
        environment: { ...env, port: target === 'pc' ? args.port : 'OS-assigned loopback (phone entrance)' },
        runs,
        summary: summarize(runs),
        routeSummary: summarizeRoutes(runs),
        notes: target === 'monitor'
          ? ['Monitor runs use the phone entrance: monitor_phone_serve backend and a proxy on OS-assigned loopback ports.', 'Status change is a CLI move while the monitor is open; the monitor refetches through its change stream.']
          : ['PC runs use agboard serve on the port given by --port.', 'Status change is a CLI move while the board is open.'],
      };
      writeFileSync(path.join(args.outDir, `${target}.json`), `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`wrote ${path.join(args.outDir, `${target}.json`)}\n`);
    }
  } finally {
    await browser.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
