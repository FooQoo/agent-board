import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mainHome, mainProject, projectId, resetBoard } from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

// The project docs on the real page: open the dialog and choose a file, which is only shown; the
// view follows changes on disk (an edit, a new file, a deletion); and the HTTP guards on the paths.

const original = '# Tasks\n\nFirst line.\n';

function docsDir(): string {
  return path.join(mainHome(), 'shared', 'projects', projectId(mainProject), 'docs');
}

function seedDocs(): void {
  rmSync(docsDir(), { recursive: true, force: true });
  mkdirSync(path.join(docsDir(), 'product'), { recursive: true });
  writeFileSync(path.join(docsDir(), 'product', 'tasks.md'), original);
}

async function openDocs(page: Page) {
  await page.goto(`/?project=${projectId(mainProject)}`);
  await waitForSync(page);
  await page.getByRole('button', { name: 'Docs' }).click();
  const dialog = page.getByRole('dialog', { name: /Docs/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseTasks(page: Page) {
  const dialog = await openDocs(page);
  // Folders start open, so the file is in the list at once.
  await dialog.getByRole('treeitem', { name: 'tasks.md' }).click();
  const editor = dialog.getByRole('textbox', { name: 'product/tasks.md' });
  await expect(editor).toContainText('First line.');
  return { dialog, editor };
}

test.beforeEach(() => {
  resetBoard(mainProject);
  seedDocs();
});

test('E2E-1: open the docs and choose a file: it is shown read-only, with nothing to save', async ({ page }) => {
  const { dialog, editor } = await chooseTasks(page);
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect(dialog.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Open in editor' })).toBeVisible();
});

test('E2E-2: the dialog follows the files on disk: an edit, a new file, and a deletion', async ({ page }) => {
  const file = path.join(docsDir(), 'product', 'tasks.md');
  const { dialog, editor } = await chooseTasks(page);

  writeFileSync(file, '# Tasks\n\nChanged on disk.\n');
  await expect(editor).toContainText('Changed on disk.');
  await expect(dialog.getByRole('status').filter({ hasText: 'The file changed, so the view was updated' })).toBeVisible();

  writeFileSync(path.join(docsDir(), 'product', 'new.md'), '# New\n');
  await expect(dialog.getByRole('treeitem', { name: 'new.md' })).toBeVisible();

  rmSync(file);
  await expect(dialog.getByRole('status').filter({ hasText: 'This file was deleted' })).toBeVisible();
  await expect(editor).toContainText('Changed on disk.');
  await expect(dialog.getByRole('treeitem', { name: 'tasks.md' })).toHaveCount(0);
});

test('E2E-3: the file API refuses traversal, absolute paths, links and other extensions, and nothing writes', async ({ page, request }) => {
  const outside = path.join(os.tmpdir(), `agboard-docs-outside-${process.pid}`);
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, 'secret.md'), 'secret');
  symlinkSync(outside, path.join(docsDir(), 'linkdir'));
  symlinkSync(path.join(outside, 'secret.md'), path.join(docsDir(), 'link.md'));
  writeFileSync(path.join(docsDir(), 'note.txt'), 'text');
  mkdirSync(path.join(docsDir(), 'dir.md'), { recursive: true });

  await page.goto('/');
  const token = (await page.locator('meta[name="agboard-token"]').getAttribute('content'))!;
  const base = `/api/projects/${projectId(mainProject)}/docs`;
  const guard = { Origin: new URL(page.url()).origin, 'Sec-Fetch-Site': 'same-origin', 'X-Agboard-Token': token };
  const bad = ['../secret.md', '../../etc/passwd', '/etc/passwd', 'product/../../x.md', 'linkdir/secret.md', 'link.md', 'note.txt', 'dir.md'];

  try {
    for (const p of bad) {
      const read = await request.get(`${base}/file`, { params: { path: p } });
      expect(read.status(), `GET ${p}`).toBeGreaterThanOrEqual(400);
      expect(await read.text(), `GET ${p}`).not.toContain('secret');
      const write = await request.put(`${base}/file`, { headers: guard, data: { path: p, content: 'pwned', expectedRevision: 'x' } });
      expect(write.status(), `PUT ${p}`).toBe(405);
      // Opening is refused before anything starts. Any existing file may be opened, so note.txt, which
      // would start an app on this computer, is left out.
      if (p !== 'note.txt') {
        const opened = await request.post(`${base}/open`, { headers: guard, params: { path: p } });
        expect(opened.status(), `open ${p}`).toBeGreaterThanOrEqual(400);
      }
    }
    expect(readFileSync(path.join(outside, 'secret.md'), 'utf8')).toBe('secret');
    expect(readFileSync(path.join(docsDir(), 'note.txt'), 'utf8')).toBe('text');
    expect(existsSync(path.join(outside, 'x.md'))).toBe(false);

    const good = { path: 'product/tasks.md', content: 'x', expectedRevision: 'x' };
    expect((await request.put(`${base}/file`, { headers: guard, data: good })).status()).toBe(405);
    for (const headers of [{} as Record<string, string>, { 'X-Agboard-Token': token }, { Origin: guard.Origin, 'Sec-Fetch-Site': 'same-origin' }]) {
      const response = await request.post(`${base}/open`, { headers, params: { path: 'product/tasks.md' } });
      expect(response.status(), JSON.stringify(Object.keys(headers))).toBe(403);
    }
    expect(readFileSync(path.join(docsDir(), 'product', 'tasks.md'), 'utf8')).toBe(original);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
