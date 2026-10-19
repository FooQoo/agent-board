import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const dist = resolve('dist');
const read = (relative: string) => readFileSync(join(dist, relative), 'utf8');
const files = (folder: string) => readdirSync(join(dist, folder)).sort();

describe('isolated monitor build', () => {
  it('emits an access entry without a token and a monitor entry with only its runtime placeholders', () => {
    const access = read('access/index.html');
    const monitor = read('monitor/index.html');
    expect(access).toMatch(/\/assets\/access\/entry\.js\?v=[a-f0-9]{16}/);
    expect(monitor).toMatch(/src="\/assets\/monitor\/monitor-[\w-]+\.js"/);
    expect(monitor).toMatch(/href="\/assets\/monitor\/monitor-[\w-]+\.css"/);
    expect(access).not.toContain('agboard-token');
    expect(monitor).toContain('name="agboard-monitor-token" content="{{AGBOARD_MONITOR_TOKEN}}"');
    expect(monitor).toContain('name="agboard-build" content="{{AGBOARD_BUILD_ID}}"');
    expect(monitor).not.toContain('name="agboard-token"');
    expect(monitor).not.toMatch(/name="agboard-monitor-token" content="[a-f0-9]{64}"/);
    expect(`${access}\n${monitor}`).not.toMatch(/\/assets\/app[-.]/);
  });

  it('bypasses the access entry saved under the previous long-lived cache policy', () => {
    const previousVersion = createHash('sha256')
      .update(read('access/entry.js'))
      .digest('hex')
      .slice(0, 16);
    expect(read('access/index.html')).not.toContain(`entry.js?v=${previousVersion}`);
  });

  it('names every monitor script and stylesheet by content and lists them in its manifest', () => {
    const monitorFiles = files('monitor');
    const embedded = monitorFiles.filter((name) => /^(monitor|chunk)-.+\.(js|css)$/.test(name));
    expect(embedded.filter((name) => name.startsWith('monitor-'))).toHaveLength(2);
    expect(monitorFiles).not.toContain('monitor.js');
    const monitorAssets = JSON.parse(read('monitor/manifest.json')).assets.map(
      (asset: { name: string }) => asset.name,
    );
    expect([...monitorAssets].sort()).toEqual(embedded);
    expect(read('monitor/manifest.json')).not.toMatch(/"app[-.]/);
    const accessAssets = JSON.parse(read('access/manifest.json')).assets.map(
      (asset: { name: string }) => asset.name,
    );
    expect(accessAssets).toEqual(['index.html', 'entry.js']);
  });

  it("reuses the board build's diagram chunks byte for byte", () => {
    const graph = JSON.parse(read('chunk-graph.json')) as {
      chunks: Record<string, { sources: string[] }>;
    };
    const shared = files('monitor').filter((name) => existsSync(join(dist, 'assets', name)));
    expect(shared.some((name) => name.startsWith('chunk-mermaid.core-'))).toBe(true);
    for (const name of shared.filter((file) => file.endsWith('.js'))) {
      expect(
        readFileSync(join(dist, 'monitor', name)).equals(readFileSync(join(dist, 'assets', name))),
        name,
      ).toBe(true);
      expect(graph.chunks[`assets/${name}`]?.sources, name).toEqual([]);
    }
  });

  it('writes a gzip copy of every embedded file', () => {
    for (const folder of ['assets', 'monitor']) {
      for (const name of files(folder).filter((file) =>
        /^(app|monitor|chunk)-.+\.(js|css)$/.test(file),
      )) {
        const gzip = readFileSync(join(dist, folder, `${name}.gz`));
        expect(gunzipSync(gzip).equals(readFileSync(join(dist, folder, name))), name).toBe(true);
      }
    }
  });

  it('keeps the monitor dependency graph independent of PC app and editor modules', () => {
    const graph = read('monitor/dependency-graph.json');
    expect(graph).not.toMatch(
      /src\/app\/App|\/editor\/|src\/shared\/rich-editor|src\/app\/api\.ts/,
    );
    expect(graph).toContain('src/app/entry/monitor.tsx');
    expect(graph).toContain('MonitorDetailDrawer');
    expect(graph).not.toMatch(
      /ReadOnlyDetail|ReadOnlyEpic|TaskDetailView|\/editor\/|src\/shared\/rich-editor/,
    );
    expect(graph).toContain('MonitorDocument');
    expect(graph).not.toMatch(
      /BodyDocumentView|AcceptanceView|MarkdownSections|tasks\/detail\/detail\.css/,
    );
  });
});

describe('board build', () => {
  it('names its scripts and stylesheets by content and loads them from the page', () => {
    const page = read('index.html');
    expect(page).toContain('name="agboard-build" content="{{AGBOARD_BUILD_ID}}"');
    expect(page).toMatch(/src="\/assets\/app-[\w-]+\.js"/);
    expect(page).toMatch(/href="\/assets\/app-[\w-]+\.css"/);
    expect(files('assets')).not.toContain('app.js');
  });

  it('loads the editor, its dialogs and the Markdown renderer after the first screen', () => {
    const graph = JSON.parse(read('chunk-graph.json')) as {
      chunks: Record<string, { sources: string[]; packages: string[] }>;
    };
    const chunks = firstLoad('assets', entryOf('assets', 'app')).map(
      (name) => graph.chunks[`assets/${name}`],
    );
    const sources = chunks.flatMap((chunk) => chunk?.sources ?? []);
    const packages = chunks.flatMap((chunk) => chunk?.packages ?? []);
    expect(packages).toContain('react-dom');
    for (const later of [
      'src/app/dialogs/ActionDialog.tsx',
      'src/features/tasks/editor/EditDialog.tsx',
      'src/features/epics/editor/EpicDialog.tsx',
      'src/shared/rich-editor/outline.ts',
      'src/shared/markdown/MarkdownSections.tsx',
      'src/shared/markdown/MarkdownView.tsx',
      'src/features/settings/ui/SettingsDialog.tsx',
    ])
      expect(sources).not.toContain(later);
    expect(
      packages.filter((name) =>
        /^(@codemirror\/|@lezer\/|micromark|mdast-|react-markdown)/.test(name),
      ),
    ).toEqual([]);
  });
});

/** The entry script of a page: `app-*.js` in `assets/` or `monitor-*.js` in `monitor/`. */
function entryOf(folder: string, prefix: string): string {
  const entry = files(folder).find((name) => new RegExp(`^${prefix}-[\\w-]+\\.js$`).test(name));
  if (!entry) throw new Error(`no ${prefix} entry in ${folder}`);
  return entry;
}

/** The entry and every chunk it imports statically: what a browser fetches before the first screen. */
function firstLoad(folder: string, entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const name = pending.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    const code = read(`${folder}/${name}`);
    for (const match of code.matchAll(/(?:from|import)\s*"\.\/([\w.-]+\.js)"/g))
      pending.push(match[1] as string);
  }
  return [...seen].sort();
}

const bytes = (folder: string, names: string[]) =>
  names.reduce((total, name) => total + readFileSync(join(dist, folder, name)).length, 0);

// Budgets for the scripts a page needs before its first screen, a little above their size today.
// Raise one only with a reason: the first load is what a phone waits for on every new build.
const FIRST_LOAD_BUDGET = { board: 660_000, monitor: 500_000 };
const LAZY_ONLY_ABOVE = 500_000;

describe('script size', () => {
  const pages = [
    { page: 'board', folder: 'assets', entry: () => entryOf('assets', 'app') },
    { page: 'monitor', folder: 'monitor', entry: () => entryOf('monitor', 'monitor') },
  ] as const;

  for (const { page, folder, entry } of pages) {
    it(`keeps the ${page}'s first load within its budget`, () => {
      expect(bytes(folder, firstLoad(folder, entry()))).toBeLessThanOrEqual(
        FIRST_LOAD_BUDGET[page],
      );
    });

    it(`loads every ${page} script over 500 kB on use only`, () => {
      const first = new Set(firstLoad(folder, entry()));
      const large = files(folder).filter(
        (name) => name.endsWith('.js') && bytes(folder, [name]) > LAZY_ONLY_ABOVE,
      );
      expect(large.filter((name) => first.has(name) && name !== entry())).toEqual([]);
    });
  }
});
