import { readdir, readFile, rename, writeFile } from 'node:fs/promises';

const monitorDir = new URL('../dist/monitor/', import.meta.url);

const FORBIDDEN = /agboard-token|\/assets\/app[-.]/;
const MONITOR_ENTRY = /^monitor-[\w-]+\.(js|css)$/;
const MONITOR_CHUNK = /^chunk-[\w.-]+\.js$/;
const MIME = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

async function finalizeMonitor() {
  const source = new URL('monitor.html', monitorDir);
  const html = await readFile(source, 'utf8');
  const files = (await readdir(monitorDir)).sort();
  const entries = files.filter((name) => MONITOR_ENTRY.test(name));
  for (const extension of ['js', 'css']) {
    const entry = entries.find((name) => name.endsWith(`.${extension}`));
    if (!entry || !html.includes(`/monitor/assets/monitor/${entry}`))
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

await finalizeMonitor();
