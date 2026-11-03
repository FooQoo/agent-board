import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { readRepoFile, repoRoot, type Lang } from './site';

// The published version in the header. It comes from scripts/release/docs-release.mjs,
// never from Cargo.toml. These tests cover the script (no browser) and the built site in the
// state it was built in: not yet published, or a fixture preview. The site has no release
// notes page; the GitHub Release is the release notes.

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

const body = (extra = '') => `## English

Opening.

### Changes
- A change.${extra}

### Fixes
- A fix.

### Breaking changes
None.

### Required update steps
None.

## 日本語

概要。

### 変更点
- 変更。

### 不具合修正
- 修正。

### 互換性に影響する変更
なし。

### 必要な更新操作
なし。
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

  test('--fixture reads the review copy of v1.0.0 and records the fixture state', () => {
    const out = tmp();
    expect(run(['--fixture'], out).status).toBe(0);
    const header = JSON.parse(fs.readFileSync(path.join(out, '.vitepress', 'release.json'), 'utf8'));
    expect(header.state).toBe('fixture');
    expect(header.version).toBe('1.0.0');
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

  test('a release without a Japanese section stops the script and writes nothing', () => {
    const out = tmp();
    const file = path.join(out, 'api.json');
    fs.writeFileSync(file, JSON.stringify([release('v1.0.0', { body: body().split('## 日本語')[0] })]));
    const result = run(['--releases-json', file], out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ja section');
    expect(fs.existsSync(path.join(out, 'releases.md'))).toBe(false);
    expect(fs.existsSync(path.join(out, '.vitepress'))).toBe(false);
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

// The state this site was built in.
function builtState(): { state: string; version: string | null; url: string | null } {
  try {
    return JSON.parse(readRepoFile('docs', '.vitepress', 'release.json'));
  } catch {
    return { state: 'unpublished', version: null, url: null };
  }
}

for (const lang of langs) {
  const prefix = lang === 'ja' ? 'ja/' : '';
  test(`the nav (${lang}) shows the version of the built state and no release notes page`, async ({ page, request }) => {
    const built = builtState();
    await page.goto(`${prefix}guide/`);
    const nav = page.locator('.VPNavBarMenu');
    await expect(nav.getByRole('link', { name: lang === 'en' ? 'Releases' : 'リリースノート' })).toHaveCount(0);
    const versionLink = nav.getByRole('link', { name: /^v\d/ });
    // Only a published release shows a version; a fixture preview shows none.
    if (built.state === 'published' && built.version) {
      await expect(versionLink).toHaveCount(1);
      await expect(versionLink).toHaveText(`v${built.version}`);
      await expect(versionLink).toHaveAttribute('href', built.url!);
    } else {
      await expect(versionLink).toHaveCount(0);
    }
    expect(fs.existsSync(path.join(repoRoot, 'docs', prefix, 'releases.md'))).toBe(false);
    expect((await request.get(`${prefix}releases`)).status()).toBe(404);
  });
}

test('the feature stages page keeps the anchors the product links to', async ({ page }) => {
  for (const lang of langs) {
    await page.goto(`${lang === 'ja' ? 'ja/' : ''}guide/feature-stages`);
    for (const id of ['docs', 'mobile-monitor', 'listen']) {
      await expect(page.locator(`.vp-doc h3[id="${id}"]`), `${lang} #${id}`).toHaveCount(1);
    }
  }
});
