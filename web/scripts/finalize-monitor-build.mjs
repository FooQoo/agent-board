import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const accessDir = new URL('../dist/access/', import.meta.url);
const monitorDir = new URL('../dist/monitor/', import.meta.url);

async function finalizeHtml(dir, sourceName, targetName, requiredScript, requiredCss) {
  const source = new URL(sourceName, dir);
  const html = await readFile(source, 'utf8');
  if (!html.includes(requiredScript))
    throw new Error(`${source.pathname} must reference ${requiredScript}`);
  if (requiredCss && !html.includes(requiredCss))
    throw new Error(`${source.pathname} must reference ${requiredCss}`);
  if (/agboard-token|\/assets\/app\.js/.test(html))
    throw new Error(`${source.pathname} contains a forbidden token or PC asset reference`);
  await rename(source, new URL(targetName, dir));
}

await finalizeHtml(accessDir, 'access.html', 'index.html', '/assets/access/entry.js');
await finalizeHtml(
  monitorDir,
  'monitor.html',
  'index.html',
  '/assets/monitor/monitor.js',
  '/assets/monitor/monitor.css',
);

const accessManifest = {
  assets: [
    { name: 'index.html', mime: 'text/html; charset=utf-8' },
    { name: 'entry.js', mime: 'text/javascript; charset=utf-8' },
  ],
};
await writeFile(
  new URL('manifest.json', accessDir),
  `${JSON.stringify(accessManifest, null, 2)}\n`,
);

const monitorManifest = {
  assets: [
    { name: 'index.html', mime: 'text/html; charset=utf-8' },
    { name: 'monitor.js', mime: 'text/javascript; charset=utf-8' },
    { name: 'monitor.css', mime: 'text/css; charset=utf-8' },
  ],
};
const { readdir } = await import('node:fs/promises');
for (const name of (await readdir(new URL('', monitorDir)))
  .filter((file) => /^viewer-[^/]+\.js$/.test(file))
  .sort()) {
  monitorManifest.assets.push({ name, mime: 'text/javascript; charset=utf-8' });
}
await writeFile(
  new URL('manifest.json', monitorDir),
  `${JSON.stringify(monitorManifest, null, 2)}\n`,
);

const accessHtml = await readFile(join(fileURLToPath(accessDir), 'index.html'), 'utf8');
const monitorHtml = await readFile(join(fileURLToPath(monitorDir), 'index.html'), 'utf8');
if (accessHtml.includes('agboard-token') || monitorHtml.includes('agboard-token'))
  throw new Error('Public entry pages must not contain the session token meta.');
