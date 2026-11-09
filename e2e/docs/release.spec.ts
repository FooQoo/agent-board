import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { readRepoFile, repoRoot, type Lang } from './site';

// scripts/release/docs-release.mjs checks the published GitHub Releases before the site is
// built, never reading Cargo.toml. These tests cover the script (no browser) and the built
// site. The header shows no version; the release notes page is written by hand in English and
// Japanese and linked from the nav.

const script = path.join(repoRoot, 'scripts', 'release', 'docs-release.mjs');
const langs: Lang[] = ['en', 'ja'];

function run(args: string[], out: string): { status: number; stderr: string } {
  try {
    execFileSync('node', [script, ...args, '--out', out], { encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stderr?: string };
    return { status: e.status ?? 1, stderr: String(e.stderr ?? '') };
  }
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agboard-docs-release-'));
}

const body = (extra = '') => `Opening.

## Changes
- A change.${extra}

## Fixes
- A fix.

## Breaking changes
None.

## Required update steps
None.
`;

function release(tag: string, over: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    body: body(),
    html_url: `https://github.com/FooQoo/agent-board/releases/tag/${tag}`,
    published_at: '2026-11-01T10:00:00Z',
    draft: false,
    prerelease: false,
    ...over,
  };
}

test.describe('docs-release script', () => {
  test('--none writes the not-yet-published state and no page', () => {
    const out = tmp();
    expect(run(['--none'], out).status).toBe(0);
    const header = JSON.parse(fs.readFileSync(path.join(out, '.vitepress', 'release.json'), 'utf8'));
    expect(header).toEqual({ state: 'unpublished', version: null, url: null });
    expect(fs.readdirSync(out)).toEqual(['.vitepress']);
  });

  test('--fixture reads the newest review copy and records the fixture state', () => {
    const out = tmp();
    expect(run(['--fixture'], out).status).toBe(0);
    const header = JSON.parse(fs.readFileSync(path.join(out, '.vitepress', 'release.json'), 'utf8'));
    expect(header.state).toBe('fixture');
    const newest = fs
      .readdirSync(path.join(repoRoot, 'releases'))
      .map((name) => /^v(\d+)\.(\d+)\.(\d+)\.md$/.exec(name))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m.slice(1).map(Number))
      .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0]
      .join('.');
    expect(header.version).toBe(newest);
    expect(fs.existsSync(path.join(out, 'releases.md'))).toBe(false);
  });

  test('only published semver releases count, the newest comes first, and Cargo.toml is not read', () => {
    const out = tmp();
    const file = path.join(out, 'api.json');
    fs.writeFileSync(
      file,
      JSON.stringify([
        release('v1.0.0'),
        release('v1.10.0'),
        release('v1.2.0'),
        release('v2.0.0-rc1'),
        release('v3.0.0', { draft: true }),
        release('v4.0.0', { prerelease: true }),
        release('nightly'),
      ]),
    );
    expect(run(['--releases-json', file], out).status).toBe(0);
    const header = JSON.parse(fs.readFileSync(path.join(out, '.vitepress', 'release.json'), 'utf8'));
    expect(header).toEqual({
      state: 'published',
      version: '1.10.0',
      url: 'https://github.com/FooQoo/agent-board/releases/tag/v1.10.0',
    });
    const cargo = /^version = "(.*)"$/m.exec(readRepoFile('Cargo.toml'))![1];
    if (cargo !== '1.10.0') expect(header.version).not.toBe(cargo);
  });

  test('a release without one of the headings stops the script and writes nothing', () => {
    const out = tmp();
    const file = path.join(out, 'api.json');
    fs.writeFileSync(file, JSON.stringify([release('v1.0.0', { body: body().replace('## Fixes', '### Fixes') })]));
    const result = run(['--releases-json', file], out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no "## Fixes" heading');
    expect(fs.existsSync(path.join(out, 'releases.md'))).toBe(false);
    expect(fs.existsSync(path.join(out, '.vitepress'))).toBe(false);
  });

  test('a heading that appears twice stops the script', () => {
    const out = tmp();
    const file = path.join(out, 'api.json');
    fs.writeFileSync(file, JSON.stringify([release('v1.0.0', { body: `${body()}\n## Changes\n- Again.\n` })]));
    const result = run(['--releases-json', file], out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"## Changes" appears 2 times');
  });

  test('a release of another repository is refused', () => {
    const out = tmp();
    const file = path.join(out, 'api.json');
    fs.writeFileSync(file, JSON.stringify([release('v1.0.0', { html_url: 'https://example.com/releases/v1.0.0' })]));
    expect(run(['--releases-json', file], out).status).toBe(1);
  });

  test('an API failure stops the script and writes nothing', () => {
    const out = tmp();
    const result = run(['--github', '--api-url', 'http://127.0.0.1:9'], out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs-release:');
    expect(fs.existsSync(path.join(out, 'releases.md'))).toBe(false);
  });
});

test.describe('Pages workflow reads the releases', () => {
  const text = readRepoFile('.github', 'workflows', 'docs.yml');

  test('runs on release events and reads them before the build, but not on pull requests', () => {
    expect(text).toMatch(/release:\n\s+types: \[published, edited, deleted\]/);
    const step = /- name: Read the published releases\n([\s\S]*?)- run: pnpm --dir docs build/.exec(text)?.[1] ?? '';
    expect(step).toContain("if: github.event_name != 'pull_request'");
    expect(step).toContain('node scripts/release/docs-release.mjs --github');
    expect(text.indexOf('docs-release.mjs')).toBeLessThan(text.indexOf('pnpm --dir docs build'));
  });

  test('a release event builds the default branch, not the tag', () => {
    const checkout = /- uses: actions\/checkout@[^\n]*\n\s+with:\n([\s\S]*?)- uses: pnpm/.exec(text)?.[1] ?? '';
    expect(checkout).toContain("github.event_name == 'release'");
    expect(checkout).toContain('github.event.repository.default_branch');
  });

  test('the generated header file is ignored by Git', () => {
    expect(readRepoFile('.gitignore')).toContain('docs/.vitepress/release.json');
  });
});

for (const lang of langs) {
  const prefix = lang === 'ja' ? 'ja/' : '';
  test(`the nav (${lang}) shows no version link`, async ({ page }) => {
    await page.goto(`${prefix}guide/`);
    await expect(page.locator('.VPNavBarMenu').getByRole('link', { name: /^v\d/ })).toHaveCount(0);
  });

  test(`the release notes page (${lang}) opens from the nav and lists v1.0.0`, async ({ page }) => {
    const label = lang === 'en' ? 'Release notes' : 'リリースノート';
    await page.goto(`${prefix}guide/`);
    const link = page.locator('.VPNavBarMenu').getByRole('link', { name: label, exact: true });
    await expect(link).toHaveAttribute('href', `/agent-board/${prefix}releases`);
    await link.click();
    await expect(page.locator('.vp-doc h1')).toHaveText(label);
    await expect(page.locator('.vp-doc h2[id="v1-0-0"]')).toHaveCount(1);
    const headings = lang === 'en'
      ? ['Changes', 'Fixes', 'Breaking changes', 'Required update steps']
      : ['変更点', '不具合修正', '互換性に影響する変更', '必要な更新操作'];
    // Every version carries the same four headings.
    const count = await page.locator('.vp-doc h2[id^="v"]').count();
    await expect(page.locator('.vp-doc h3')).toHaveText(Array.from({ length: count }, () => headings).flat());
  });
}

test('the English and Japanese release notes list the same versions in the same order', () => {
  const versions = (lang: Lang) =>
    [...readRepoFile('docs', ...(lang === 'ja' ? ['ja'] : []), 'releases.md').matchAll(/^## (v\d+\.\d+\.\d+)$/gm)].map(
      (m) => m[1],
    );
  expect(versions('en')).toContain('v1.0.0');
  expect(versions('ja')).toEqual(versions('en'));
});

test('the feature stages page keeps the anchors the product links to', async ({ page }) => {
  for (const lang of langs) {
    await page.goto(`${lang === 'ja' ? 'ja/' : ''}guide/feature-stages`);
    for (const id of ['docs', 'mobile-monitor', 'listen']) {
      await expect(page.locator(`.vp-doc h3[id="${id}"]`), `${lang} #${id}`).toHaveCount(1);
    }
  }
});
