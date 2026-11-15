// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dist = resolve('dist');
const read = (relative: string) => readFileSync(join(dist, relative), 'utf8');
const files = (folder: string) => readdirSync(join(dist, folder)).sort();

describe('board build', () => {
  it('names its scripts and stylesheets by content and loads them from the page', () => {
    const page = read('index.html');
    expect(page).toContain('name="agboard-build" content="{{AGBOARD_BUILD_ID}}"');
    expect(page).toMatch(/src="\/assets\/app-[\w-]+\.js"/);
    expect(page).toMatch(/href="\/assets\/app-[\w-]+\.css"/);
    expect(files('assets')).not.toContain('app.js');
  });

  it('ships none of the sample-data server or the demo transport', () => {
    const graph = JSON.parse(read('chunk-graph.json')) as {
      chunks: Record<string, { sources: string[] }>;
    };
    const sources = Object.values(graph.chunks).flatMap((chunk) => chunk.sources);
    expect(sources.filter((source) => source.startsWith('src/app/development/'))).toEqual([]);
    for (const name of files('assets').filter((file) => file.endsWith('.js')))
      expect(read(`assets/${name}`), name).not.toMatch(/DemoEventSource|demo-token|__mock\//);
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
      'src/shared/markdown/MarkdownBlocks.tsx',
      'src/shared/markdown/MarkdownBlock.tsx',
      'src/shared/markdown/MarkdownContent.tsx',
      'src/shared/markdown/VirtualMarkdown.tsx',
      'src/features/settings/ui/SettingsDialog.tsx',
    ])
      expect(sources).not.toContain(later);
    expect(
      packages.filter((name) =>
        /^(@codemirror\/|@lezer\/|micromark|mdast-|react-markdown)/.test(name),
      ),
    ).toEqual([]);
    expect(packages.filter((name) => name.startsWith('@tanstack/'))).toEqual([]);
  });
});

describe('virtual Markdown list', () => {
  const pages = [
    { page: 'board', folder: 'assets', entry: () => entryOf('assets', 'app') },
  ] as const;

  for (const { page, folder, entry } of pages) {
    it(`keeps the ${page}'s virtual list in one on-demand chunk of its own`, () => {
      const first = new Set(firstLoad(folder, entry()));
      const holders = files(folder).filter(
        (name) => name.endsWith('.js') && /^chunk-VirtualMarkdown-[\w-]+\.js$/.test(name),
      );
      expect(holders).toHaveLength(1);
      expect(first.has(holders[0] as string)).toBe(false);
      // The list and its library are small: well under what the first load may grow by.
      expect(bytes(folder, holders)).toBeLessThanOrEqual(VIRTUAL_CHUNK_BUDGET);
    });
  }

  it('bundles the virtual list library with the list and in no other chunk', () => {
    const graph = JSON.parse(read('chunk-graph.json')) as {
      chunks: Record<string, { sources: string[]; packages: string[] }>;
    };
    const holders = Object.entries(graph.chunks)
      .filter(([, chunk]) => chunk.packages.includes('@tanstack/react-virtual'))
      .map(([name, chunk]) => ({ name, sources: chunk.sources }));
    expect(holders).toHaveLength(1);
    expect(holders[0]?.sources).toEqual(['src/shared/markdown/VirtualMarkdown.tsx']);
  });
});

/** The entry script of a page: `app-*.js` in `assets/`. */
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
// The board's budget is 700 KB: the Docs entry, the condition checkboxes of the details, the preview's strings and entrances,
// and the answer dialog's strings (all languages load with the page) fit in the room that removing the old answer form left.
// The band of unanswered questions above the lanes and the page's book of held answers take about 3.7 KB over that;
// the dialog's run through the questions and its strings load on first use.
// The band's open/close toggle and the header's option to leave out the settings button take about 0.3 KB more.
const FIRST_LOAD_BUDGET = { board: 707_000 };
const LAZY_ONLY_ABOVE = 500_000;
// The virtual list chunk (the list and @tanstack/react-virtual) loads for a large document only.
const VIRTUAL_CHUNK_BUDGET = 40_000;

describe('script size', () => {
  const pages = [
    { page: 'board', folder: 'assets', entry: () => entryOf('assets', 'app') },
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
