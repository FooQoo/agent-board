import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mainHome, mainProject, projectId, resetBoard } from '../helpers/agboard';
import { waitForSync } from '../helpers/ui';

// The project docs on the real page: open the dialog, choose a file, edit and save it to disk, a save that finds the
// file changed on disk (reload or overwrite), and the HTTP guards on the paths.

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

test('E2E-1: open the docs, choose a file, edit it, save it, and reopen it', async ({ page }) => {
  const { dialog, editor } = await chooseTasks(page);
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Added by the test.');
  await expect(dialog.getByText('Unsaved changes')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('No changes')).toBeVisible();
  await expect.poll(() => readFileSync(path.join(docsDir(), 'product', 'tasks.md'), 'utf8')).toContain('Added by the test.');
  expect(readFileSync(path.join(docsDir(), 'product', 'tasks.md'), 'utf8')).toContain('First line.');

  await dialog.getByRole('button', { name: 'Close' }).last().click();
  await expect(dialog).toBeHidden();
  const again = await chooseTasks(page);
  await expect(again.editor).toContainText('Added by the test.');
});

test('E2E-2: a save after an outside change shows the conflict; reload takes the latest, overwrite keeps the input', async ({ page }) => {
  const file = path.join(docsDir(), 'product', 'tasks.md');
  for (const choice of ['reload', 'overwrite'] as const) {
    seedDocs();
    const { dialog, editor } = await chooseTasks(page);
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('Mine.');
    writeFileSync(file, '# Tasks\n\nChanged outside.\n');
    await dialog.getByRole('button', { name: 'Save' }).click();
    const banner = dialog.getByRole('alert').filter({ hasText: 'The file was changed outside this screen' });
    await expect(banner).toBeVisible();
    expect(readFileSync(file, 'utf8')).toBe('# Tasks\n\nChanged outside.\n');
    if (choice === 'reload') {
      await banner.getByRole('button', { name: 'Reload the latest' }).click();
      await expect(banner.getByText('Discard your edits and reload?')).toBeVisible();
      await banner.getByRole('button', { name: 'Discard and reload' }).click();
      await expect(editor).toContainText('Changed outside.');
      await expect(editor).not.toContainText('Mine.');
      await expect(banner).toBeHidden();
      expect(readFileSync(file, 'utf8')).toBe('# Tasks\n\nChanged outside.\n');
    } else {
      await banner.getByRole('button', { name: 'Overwrite with mine' }).click();
      await expect(banner).toBeHidden();
      await expect.poll(() => readFileSync(file, 'utf8')).toContain('Mine.');
      expect(readFileSync(file, 'utf8')).toContain('First line.');
      expect(readFileSync(file, 'utf8')).not.toContain('Changed outside.');
    }
    await page.reload();
  }
});

test('E2E-3: the file API refuses traversal, absolute paths, links, other extensions and unguarded writes', async ({ page, request }) => {
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
      expect(write.status(), `PUT ${p}`).toBeGreaterThanOrEqual(400);
    }
    expect(readFileSync(path.join(outside, 'secret.md'), 'utf8')).toBe('secret');
    expect(readFileSync(path.join(docsDir(), 'note.txt'), 'utf8')).toBe('text');
    expect(existsSync(path.join(outside, 'x.md'))).toBe(false);

    const good = { path: 'product/tasks.md', content: 'x', expectedRevision: 'x' };
    for (const headers of [{} as Record<string, string>, { 'X-Agboard-Token': token }, { Origin: guard.Origin, 'Sec-Fetch-Site': 'same-origin' }]) {
      const response = await request.put(`${base}/file`, { headers, data: good });
      expect(response.status(), JSON.stringify(Object.keys(headers))).toBe(403);
    }
    expect(readFileSync(path.join(docsDir(), 'product', 'tasks.md'), 'utf8')).toBe(original);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
