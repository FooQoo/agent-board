import { expect, test } from '../helpers/fixtures';
import { agboardOk, mainProject, nextTaskId, resetBoard } from '../helpers/agboard';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(() => resetBoard(mainProject));

test('attachments added from the CLI appear in the detail list and CLI can read their bytes', async ({ page }, info) => {
  const id = nextTaskId(mainProject);
  agboardOk(mainProject, ['add', 'Dropped image', '--assignee', 'human', '--actor', 'human']);
  const { readFileSync, writeFileSync } = await import('node:fs');
  const file = info.outputPath('cli.png');
  writeFileSync(file, png);
  agboardOk(mainProject, ['attachment', 'add', String(id), '--file', file, '--actor', 'ai']);
  const saved = JSON.parse(agboardOk(mainProject, ['show', String(id), '--json']).stdout).task;
  const output = info.outputPath('downloaded.png');
  agboardOk(mainProject, ['attachment', 'get', String(id), saved.attachments[0].id, '--output', output]);
  expect(readFileSync(output)).toEqual(png);

  await page.goto('/');
  await waitForSync(page);
  await readBoardAfterReset(page);
  await page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) }).click();
  const detail = page.getByRole('complementary', { name: 'Task details' });
  await expect(detail.locator('.detail-attachments__tile')).toHaveCount(1);
  await expect
    .poll(() =>
      detail
        .locator('.detail-attachments__tile img')
        .evaluateAll((images) => images.every((i) => (i as HTMLImageElement).naturalWidth === 1)),
    )
    .toBe(true);
});
