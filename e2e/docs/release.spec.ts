import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { readRepoFile, repoRoot, type Lang } from './site';

// The published version in the header and the release notes pages. They come from
// scripts/release/docs-release.mjs, never from Cargo.toml. These tests cover the script
// (no browser) and the built site in the state it was built in: not yet published, or a
// fixture preview.

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
  test('--none writes the not-yet-published state, and the committed pages are that state', () => {
    const out = tmp();
    expect(run(['--none'], out).status).toBe(0);
    const header = JSON.parse(fs.readFileSync(path.join(out, '.vitepress', 'release.json'), 'utf8'));
    expect(header).toEqual({ state: 'unpublished', version: null, url: null });
    for (const [rel, committed] of [
      ['releases.md', 'docs/releases.md'],
      ['ja/releases.md', 'docs/ja/releases.md'],
    ]) {
      const text = fs.readFileSync(path.join(out, rel), 'utf8');
      expect(text).toBe(readRepoFile(committed));
    }
    expect(fs.readFileSync(path.join(out, 'releases.md'), 'utf8')).toContain('No release has been published yet.');
    expect(fs.readFileSync(path.join(out, 'ja', 'releases.md'), 'utf8')).toContain('まだ公開されたリリースはありません。');
  });

  test('--fixture shows the review copy of v1.0.0 with a warning, in both languages', () => {
    const out = tmp();
    expect(run(['--fixture'], out).status).toBe(0);
    const header = JSON.parse(fs.readFileSync(path.join(out, '.vitepress', 'release.json'), 'utf8'));
    expect(header.state).toBe('fixture');
    expect(header.version).toBe('1.0.0');
    const en = fs.readFileSync(path.join(out, 'releases.md'), 'utf8');
    const ja = fs.readFileSync(path.join(out, 'ja', 'releases.md'), 'utf8');
    expect(en).toContain('## v1.0.0');
    expect(en).toContain('not from a published GitHub Release');
    expect(en).toContain('### Required update steps');
    expect(en).not.toContain('### 変更点');
    expect(ja).toContain('## v1.0.0');
    expect(ja).toContain('公開済みのGitHub Releaseではなく');
    expect(ja).toContain('### 必要な更新操作');
    expect(ja).not.toContain('### Changes');
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
    const en = fs.readFileSync(path.join(out, 'releases.md'), 'utf8');
    expect([...en.matchAll(/^## (v[\d.]+)$/gm)].map((m) => m[1])).toEqual(['v1.10.0', 'v1.2.0', 'v1.0.0']);
    expect(en).not.toContain('not from a published GitHub Release');
    expect(en).toContain('Published on 2026-11-01.');
    const cargo = /^version = "(.*)"$/m.exec(readRepoFile('Cargo.toml'))![1];
    if (!['1.10.0', '1.2.0', '1.0.0'].includes(cargo)) expect(en).not.toContain(`v${cargo}`);
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

const labels = {
  en: { releases: 'Releases', title: 'Releases', none: 'No release has been published yet.', fixture: 'not from a published GitHub Release' },
  ja: { releases: 'リリースノート', title: 'リリースノート', none: 'まだ公開されたリリースはありません。', fixture: '公開済みのGitHub Releaseではなく' },
} as const;

for (const lang of langs) {
  const prefix = lang === 'ja' ? 'ja/' : '';
  test(`nav and release page (${lang}) match the built state`, async ({ page }) => {
    const built = builtState();
    await page.goto(`${prefix}guide/`);
    const nav = page.locator('.VPNavBarMenu');
    await expect(nav.getByRole('link', { name: labels[lang].releases })).toHaveAttribute('href', `/agent-board/${prefix}releases`);
    const versionLink = nav.getByRole('link', { name: /^v\d/ });
    // Only a published release shows a version; a fixture preview shows none.
    if (built.state === 'published' && built.version) {
      await expect(versionLink).toHaveCount(1);
      await expect(versionLink).toHaveText(`v${built.version}`);
      await expect(versionLink).toHaveAttribute('href', built.url!);
    } else {
      await expect(versionLink).toHaveCount(0);
    }

    await nav.getByRole('link', { name: labels[lang].releases }).click();
    await expect(page).toHaveURL(new RegExp(`/agent-board/${prefix}releases$`));
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('.vp-doc h1')).toHaveText(labels[lang].title);
    const doc = page.locator('.vp-doc');
    if (built.state === 'unpublished') {
      await expect(doc).toContainText(labels[lang].none);
      await expect(doc.locator('h2')).toHaveCount(0);
    } else {
      await expect(doc.locator('h2').first()).toHaveText(`v${built.version}`);
      if (built.state === 'fixture') await expect(doc).toContainText(labels[lang].fixture);
      const own = lang === 'en' ? 'Required update steps' : '必要な更新操作';
      const other = lang === 'en' ? '必要な更新操作' : 'Required update steps';
      await expect(doc.getByRole('heading', { name: own })).toHaveCount(1);
      await expect(doc.getByRole('heading', { name: other })).toHaveCount(0);
    }
    expect(await doc.evaluate((el) => (el.textContent ?? '').includes('**'))).toBe(false);
  });

  test(`the release page (${lang}) has no horizontal scroll at 375px and 1280px, in light and dark`, async ({ page }) => {
    for (const width of [375, 1280]) {
      for (const scheme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await page.addInitScript((value) => localStorage.setItem('vitepress-theme-appearance', value), scheme);
        await page.goto(`${prefix}releases`);
        await expect(page.locator('.vp-doc h1')).toBeVisible();
        const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
        expect(overflow.scroll, `${lang} ${width} ${scheme}`).toBeLessThanOrEqual(overflow.inner);
      }
    }
  });
}

test('the phone menu lists the release notes link', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('guide/');
  await page.locator('.VPNavBarHamburger').click();
  await expect(page.locator('.VPNavScreen').getByRole('link', { name: 'Releases' })).toHaveAttribute('href', '/agent-board/releases');
});

test('the feature stages page keeps the anchors the product links to', async ({ page }) => {
  for (const lang of langs) {
    await page.goto(`${lang === 'ja' ? 'ja/' : ''}guide/feature-stages`);
    for (const id of ['docs', 'mobile-monitor', 'onboarding', 'connect-and-update', 'listen']) {
      await expect(page.locator(`.vp-doc h3[id="${id}"]`), `${lang} #${id}`).toHaveCount(1);
    }
  }
});
