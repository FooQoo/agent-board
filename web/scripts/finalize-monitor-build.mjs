import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const accessDir = new URL('../dist/access/', import.meta.url);
const monitorDir = new URL('../dist/monitor/', import.meta.url);

const FORBIDDEN = /agboard-token|\/assets\/app[-.]/;
const MONITOR_ENTRY = /^monitor-[\w-]+\.(js|css)$/;
const MONITOR_CHUNK = /^chunk-[\w.-]+\.js$/;
const MIME = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

async function finalizeAccess() {
  const source = new URL('access.html', accessDir);
  const script = '/assets/access/entry.js';
  let html = await readFile(source, 'utf8');
  if (!html.includes(script)) throw new Error(`${source.pathname} must reference ${script}`);
  if (FORBIDDEN.test(html))
    throw new Error(`${source.pathname} contains a forbidden token or PC asset reference`);
  // The access script keeps a fixed name and is never cached; the version only makes browsers
  // skip a copy saved under an earlier long-lived cache policy.
  const version = createHash('sha256')
    .update('agboard-remote-assets:no-store\0')
    .update(await readFile(new URL('entry.js', accessDir)))
    .digest('hex')
    .slice(0, 16);
  html = html.replaceAll(script, `${script}?v=${version}`);
  await writeFile(source, html);
  await rename(source, new URL('index.html', accessDir));
  if (html.includes('agboard-token'))
    throw new Error('The public access entry must not contain a session token meta.');
  const manifest = {
    assets: [
      { name: 'index.html', mime: 'text/html; charset=utf-8' },
      { name: 'entry.js', mime: MIME.js },
    ],
  };
  await writeFile(new URL('manifest.json', accessDir), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function finalizeMonitor() {
  const source = new URL('monitor.html', monitorDir);
  const html = await readFile(source, 'utf8');
  const files = (await readdir(monitorDir)).sort();
  const entries = files.filter((name) => MONITOR_ENTRY.test(name));
  for (const extension of ['js', 'css']) {
    const entry = entries.find((name) => name.endsWith(`.${extension}`));
    if (!entry || !html.includes(`/assets/monitor/${entry}`))
      throw new Error(`${source.pathname} must reference the content-named monitor .${extension}`);
  }
  if (FORBIDDEN.test(html))
    throw new Error(`${source.pathname} contains a forbidden token or PC asset reference`);
  if (!html.includes('name="agboard-monitor-token" content="{{AGBOARD_MONITOR_TOKEN}}"'))
    throw new Error('The monitor entry must contain only its runtime token placeholder.');
  if (!html.includes('name="agboard-build" content="{{AGBOARD_BUILD_ID}}"'))
    throw new Error('The monitor entry must contain the build ID placeholder.');
  await rename(source, new URL('index.html', monitorDir));

  const assets = [...entries, ...files.filter((name) => MONITOR_CHUNK.test(name))].map((name) => ({
    name,
    mime: MIME[name.split('.').at(-1)],
  }));
  await writeFile(new URL('manifest.json', monitorDir), `${JSON.stringify({ assets }, null, 2)}\n`);
}

await finalizeAccess();
await finalizeMonitor();
