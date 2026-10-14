import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { allPages, guideFiles, guideScreenshots, readRepoFile, repoRoot } from './site';

// Static checks that need no browser: the Pages workflow, links to the removed documents,
// the contributor instructions, and the source files behind the pages.

// Split the workflow into its top-level sections ("on", "permissions", "jobs", ...) and jobs.
function workflowParts(text: string) {
  const sections: Record<string, string> = {};
  let current = '';
  for (const line of text.split('\n')) {
    const key = /^([a-z-]+):/.exec(line);
    if (key) current = key[1];
    sections[current] = (sections[current] ?? '') + line + '\n';
  }
  const jobs: Record<string, string> = {};
  let job = '';
  for (const line of (sections.jobs ?? '').split('\n')) {
    const key = /^ {2}([a-z-]+):\s*$/.exec(line);
    if (key) job = key[1];
    if (job) jobs[job] = (jobs[job] ?? '') + line + '\n';
  }
  return { sections, jobs };
}

test.describe('Pages workflow (AC-9)', () => {
  const text = readRepoFile('.github', 'workflows', 'docs.yml');
  const { sections, jobs } = workflowParts(text);
  const paths = ['"docs/**"', '".github/workflows/docs.yml"'];

  test('runs on pull requests and pushes to main that touch docs, and on demand', () => {
    const on = sections.on;
    const pullRequest = /pull_request:\n([\s\S]*?)\n {2}(?:push|workflow_dispatch):/.exec(on)?.[1] ?? '';
    const push = /push:\n([\s\S]*?)\n {2}workflow_dispatch:/.exec(on)?.[1] ?? '';
    for (const p of paths) {
      expect(pullRequest).toContain(p);
      expect(push).toContain(p);
    }
    expect(pullRequest).not.toContain('branches');
    expect(push).toMatch(/branches: \[main\]/);
    expect(on).toContain('workflow_dispatch:');
  });

  test('keeps the default permission read-only and serializes runs in the pages group', () => {
    expect(sections.permissions).toMatch(/contents: read/);
    expect(sections.permissions).not.toMatch(/pages: write|id-token: write/);
    expect(sections.concurrency).toMatch(/group: pages/);
  });

  test('build job only installs and builds, and uploads the artifact outside pull requests', () => {
    expect(Object.keys(jobs).sort()).toEqual(['build', 'deploy']);
    const build = jobs.build;
    expect(build).toContain('pnpm --dir docs install --frozen-lockfile');
    expect(build).toContain('pnpm --dir docs build');
    expect(build).toMatch(/version: 12/);
    expect(build).toMatch(/node-version: 24/);
    expect(build).toContain('cache-dependency-path: docs/pnpm-lock.yaml');
    expect(build).not.toMatch(/cargo|rustup|web build|--dir web/);
    expect(build).not.toMatch(/pages: write|id-token: write/);
    // Upload and Pages configuration are skipped on pull requests.
    for (const action of ['actions/configure-pages', 'actions/upload-pages-artifact']) {
      const step = new RegExp(`uses: ${action}@\\S+\\n\\s+if: github.event_name != 'pull_request'`);
      expect(build).toMatch(step);
    }
    expect(build).toContain('path: docs/.vitepress/dist');
  });

  test('deploy job runs only off pull requests, after the build, with the Pages permissions', () => {
    const deploy = jobs.deploy;
    expect(deploy).toContain("if: github.event_name != 'pull_request'");
    expect(deploy).toMatch(/needs: build/);
    expect(deploy).toMatch(/pages: write/);
    expect(deploy).toMatch(/id-token: write/);
    expect(deploy).toMatch(/name: github-pages/);
    expect(deploy).toMatch(/uses: actions\/deploy-pages@/);
  });
});

test.describe('removed documents (AC-10)', () => {
  test('the old usage and mobile monitor sources are gone', () => {
    for (const name of ['usage.md', 'mobile-monitor.md']) {
      expect(fs.existsSync(path.join(repoRoot, 'docs', name)), `docs/${name}`).toBe(false);
    }
  });

  test('nothing in the repository links to them', () => {
    const patterns = ['docs/usage.md', 'docs/mobile-monitor.md', '](usage.md', '](mobile-monitor.md', '](./usage.md', '](./mobile-monitor.md', '](../usage.md', '](../mobile-monitor.md'];
    for (const pattern of patterns) {
      let out = '';
      try {
        out = execFileSync(
          'git',
          ['grep', '-nF', pattern, '--', '.', ':(exclude)e2e/docs'],
          { cwd: repoRoot, encoding: 'utf8' },
        );
      } catch (error) {
        // git grep exits 1 when nothing matches.
        if ((error as { status?: number }).status !== 1) throw error;
      }
      expect(out, `references to ${pattern}`).toBe('');
    }
  });

  test('READMEs and integration notes link to the site', () => {
    const site = 'https://fooqoo.github.io/agent-board/';
    for (const file of ['README.md', 'README.ja.md', path.join('integrations', 'README.md')]) {
      expect(readRepoFile(file), file).toContain(site);
    }
    expect(readRepoFile('README.ja.md')).toContain(`${site}ja/guide/`);
    expect(readRepoFile('integrations', 'README.md')).toMatch(/agent-board\/guide\//);
  });
});

test.describe('contributor instructions (AC-10)', () => {
  test('AGENTS.md allows the Japanese site pages and documents the docs workflow', () => {
    const agents = readRepoFile('AGENTS.md');
    expect(agents).toContain('docs/ja/**');
    expect(agents).toContain('CONTRIBUTING.ja.md');
    for (const command of [
      'pnpm --dir docs install',
      'pnpm --dir docs build',
      'pnpm --dir docs dev',
      'node e2e/scripts/docs-screenshots.mjs',
      'node e2e/scripts/demo-video.mjs',
    ]) {
      expect(agents, command).toContain(command);
    }
  });

  for (const file of ['CONTRIBUTING.md', 'CONTRIBUTING.ja.md']) {
    test(`${file} describes build, preview, screenshots, videos, and the workflow`, () => {
      const text = readRepoFile(file);
      for (const command of [
        'pnpm --dir docs install',
        'pnpm --dir docs dev',
        'pnpm --dir docs build',
        'pnpm --dir docs preview',
        'node e2e/scripts/docs-screenshots.mjs',
        'node e2e/scripts/demo-video.mjs',
        '.github/workflows/docs.yml',
        'docs/ja/',
      ]) {
        expect(text, command).toContain(command);
      }
    });
  }
});

test.describe('site sources', () => {
  test('both languages have the same pages with the same number of sections', () => {
    for (const file of guideFiles) {
      const en = readRepoFile('docs', 'guide', `${file}.md`);
      const ja = readRepoFile('docs', 'ja', 'guide', `${file}.md`);
      const sections = (text: string) => text.split('\n').filter((line) => /^## /.test(line)).length;
      expect(sections(ja), `${file}: ## headings`).toBe(sections(en));
      expect(en).not.toContain('docs-site:placeholder');
      expect(ja).not.toContain('docs-site:placeholder');
    }
    expect(allPages).toHaveLength(22);
  });

  test('the twelve guide screenshots exist as readable PNGs', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const name of Object.keys(guideScreenshots)) {
      for (const suffix of ['.png', '.ja.png']) {
        const file = path.join(repoRoot, 'docs', 'images', 'guide', `${name}${suffix}`);
        const data = fs.readFileSync(file);
        expect(data.subarray(0, 8).equals(png), `${name}${suffix} is a PNG`).toBe(true);
        expect(data.readUInt32BE(16), `${name}${suffix} width`).toBeGreaterThan(0);
        expect(data.readUInt32BE(20), `${name}${suffix} height`).toBeGreaterThan(0);
      }
    }
    expect(fs.readdirSync(path.join(repoRoot, 'docs', 'images', 'guide')).filter((f) => f.endsWith('.png'))).toHaveLength(12);
  });

  test('demo videos and posters are committed and the videos are small enough', () => {
    for (const name of ['demo.mp4', 'demo.ja.mp4', 'demo.jpg', 'demo.ja.jpg']) {
      const file = path.join(repoRoot, 'docs', 'public', 'videos', name);
      expect(fs.statSync(file).size, name).toBeGreaterThan(0);
      if (name.endsWith('.mp4')) expect(fs.statSync(file).size, name).toBeLessThanOrEqual(6 * 1024 * 1024);
    }
  });

  test('build output and cache are ignored by Git', () => {
    const ignore = readRepoFile('.gitignore');
    expect(ignore).toContain('docs/.vitepress/dist/');
    expect(ignore).toContain('docs/.vitepress/cache/');
  });
});
