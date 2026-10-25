import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetBoard, agboardOk, mainProject, projectId } from '../helpers/agboard';
import { resetPreferences, setPreferences } from '../helpers/preferences';
import { readBoardAfterReset, waitForSync } from '../helpers/ui';

// Headless Chromium hides scrollbars by default; the scroll cue needs the real ones.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

const STORAGE_KEY = 'agboard.detailWidth';

test.beforeEach(async () => {
  resetBoard(mainProject);
  await resetPreferences();
});

test.afterEach(() => resetPreferences());

async function open(page: Page, width: number, height = 900): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(`/?project=${projectId(mainProject)}`);
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const handle = (page: Page) => page.getByRole('separator', { name: 'Resize task details' });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('element has no box');
  return found;
}

const panelWidth = async (page: Page) => (await box(panel(page))).width;

/** Drag the handle so that its centre ends at `toX` (a real mouse). */
async function dragTo(page: Page, toX: number): Promise<void> {
  const h = await box(handle(page));
  const y = h.y + h.height / 2;
  await page.mouse.move(h.x + h.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 8 });
  await page.mouse.up();
}

/** Drag the handle by `dx` pixels (negative is left). */
async function dragBy(page: Page, dx: number): Promise<void> {
  const h = await box(handle(page));
  await dragTo(page, h.x + h.width / 2 + dx);
}

const computed = (page: Page, selector: string, props: string[]) =>
  page.evaluate(
    ([sel, names]) => {
      const el = document.querySelector(sel as string);
      if (!el) throw new Error(`no ${sel}`);
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const out: Record<string, string | number> = { x: rect.x, width: rect.width, height: rect.height };
      for (const name of names as string[]) out[name] = style.getPropertyValue(name);
      return out;
    },
    [selector, props] as const,
  );

function fillDone(extra = 14): void {
  for (let i = 0; i < extra; i += 1) agboardOk(mainProject, ['add', `Extra done task ${i + 1}`]);
  const tasks = JSON.parse(agboardOk(mainProject, ['ls', '--json']).stdout).tasks as { id: number; title: string }[];
  for (const c of tasks.filter((x) => x.title.startsWith('Extra done task'))) agboardOk(mainProject, ['mv', String(c.id), 'done']);
}

// ---------------------------------------------------------------- Desktop layout

for (const locale of ['en', 'ja']) {
  for (const detailWidth of [280, 360, 560]) {
    test(`${locale}: tabs and draft actions fit a ${detailWidth}px detail column`, async ({ page }, testInfo) => {
      await setPreferences({ locale: locale as 'en' | 'ja' });
      await page.addInitScript((detailWidth) => {
        localStorage.setItem('agboard.detailWidth', String(detailWidth));
      }, detailWidth);
      await page.setViewportSize({ width: 1920, height: 900 });
      await page.goto(`/?project=${projectId(mainProject)}`);
      await waitForSync(page);
      // The server notices the reset 200 ms later: read the board again, not the one from before it.
      await readBoardAfterReset(page);
      await task(page, 8).click();
      const detail = page.locator('.detail');
      const row = await box(detail.locator('.detail__tabs'));
      const tabs = await box(detail.getByRole('tablist'));
      const toolbar = await box(detail.getByRole('toolbar'));
      const header = await box(detail.locator('.detail__top'));
      // The tabs keep their row; the card's actions sit in the header, inside the column.
      expect(tabs.x + tabs.width).toBeLessThanOrEqual(row.x + row.width + 1);
      expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(header.x + header.width + 1);
      expect(toolbar.y).toBeLessThan(tabs.y);
      for (const tab of await detail.getByRole('tab').all()) {
        const wrapped = await tab.evaluate((element) => {
          const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
          return Array.from(element.childNodes).some((node) => {
            if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return false;
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getBoundingClientRect().height > lineHeight * 1.1;
          });
        });
        expect(wrapped, 'tab labels stay on one line').toBe(false);
      }
      const makeDraft = detail.getByRole('button', { name: locale === 'ja' ? '下書きにする' : 'Make draft' });
      await expect(makeDraft).toHaveAttribute('title', locale === 'ja' ? '下書きにする' : 'Make draft');
      await page.screenshot({ path: testInfo.outputPath('detail-toolbar.png') });
      await makeDraft.click();
      await expect(detail.getByRole('region', { name: locale === 'ja' ? '下書き' : 'Draft', exact: true })).toBeVisible();
    });
  }
}

for (const width of [1024, 1280, 1920]) {
  test(`${width}px: the same insets, header and footer at every width`, async ({ page }) => {
    await open(page, width);
    const lanes = await computed(page, '.board__lanes', ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'column-gap']);
    expect([lanes['padding-top'], lanes['padding-right'], lanes['padding-bottom'], lanes['padding-left']]).toEqual([
      '24px',
      '24px',
      '24px',
      '24px',
    ]);
    expect(lanes['column-gap']).toBe('16px');
    const header = await computed(page, '.header', ['padding-left', 'padding-right']);
    expect(header.height).toBe(56);
    expect([header['padding-left'], header['padding-right']]).toEqual(['24px', '24px']);
    const footer = await computed(page, '.status-bar', ['padding-left', 'padding-right']);
    expect(footer.height).toBe(40);
    expect([footer['padding-left'], footer['padding-right']]).toEqual(['24px', '24px']);

    // Type sizes and lane padding do not scale with the width.
    expect((await computed(page, '.card__title', ['font-size']))['font-size']).toBe('14px');
    expect((await computed(page, '.lane', ['padding-left']))['padding-left']).toBe('12px');

    // Three lanes side by side, the detail column on the right, the handle and the close button usable.
    const boxes = await page.locator('.lane').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(boxes).toHaveLength(3);
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
    expect(boxes[1].x).toBeLessThan(boxes[2].x);
    for (const lane of boxes) expect(lane.width).toBeGreaterThanOrEqual(200);
    const panelBox = await box(panel(page));
    expect(panelBox.x + panelBox.width).toBe(width);
    expect(boxes[2].x + boxes[2].width).toBeLessThanOrEqual(panelBox.x);
    await expect(handle(page)).toBeVisible();
    await task(page, 8).click();
    await expect(panel(page).getByRole('button', { name: 'Close details' })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Close details' }).click();
    await expect(panel(page).getByText('Select a task to see its details.')).toBeVisible();
  });
}

test('1024px: the default width yields to the lanes (each stays at least 200px)', async ({ page }) => {
  await open(page, 1024);
  expect(await panelWidth(page)).toBe(344);
  const lanes = await page.locator('.lane').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  for (const w of lanes) expect(w).toBeGreaterThanOrEqual(200);
});

test('1920px: the extra width goes to the lanes and the panel keeps its width', async ({ page }) => {
  await open(page, 1920);
  expect(await panelWidth(page)).toBe(360);
  const lanes = await page.locator('.lane').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  for (const w of lanes) expect(w).toBeCloseTo((1920 - 360 - 48 - 32) / 3, 0);
});

// ---------------------------------------------------------------- Scroll cue

async function cue(page: Page, index: number) {
  return page.evaluate((i) => {
    const scroll = document.querySelectorAll('.lane__scroll')[i];
    const list = scroll.querySelector('.lane__cards') as HTMLElement;
    const after = getComputedStyle(scroll, '::after');
    return {
      more: (scroll as HTMLElement).dataset.more,
      bar: list.offsetWidth - list.clientWidth,
      overflows: list.scrollHeight > list.clientHeight,
      fade: after.content !== 'none' && after.content !== 'normal' ? Number.parseFloat(after.height) : 0,
    };
  }, index);
}

test('1280px: an overflowing Done lane shows the fade and a scrollbar until the bottom', async ({ page }) => {
  fillDone();
  await open(page, 1280);
  // The board follows the files a moment after they change, so the lane is measured once all 16 cards are shown.
  await expect(page.locator('.lane__cards').nth(2).locator('.card')).toHaveCount(16);
  const done = await cue(page, 2);
  expect(done.overflows).toBe(true);
  expect(done.more).toBe('true');
  expect(done.bar).toBeGreaterThan(0);
  expect(done.fade).toBe(72);
  for (const index of [0, 1]) {
    const lane = await cue(page, index);
    expect(lane.more).toBe('false');
    expect(lane.bar).toBe(0);
    expect(lane.fade).toBe(0);
  }
  await page.locator('.lane__cards').nth(2).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(async () => (await cue(page, 2)).more).toBe('false');
  expect((await cue(page, 2)).fade).toBe(0);
});

test('1920px: a lane that fits its tasks shows neither fade nor scrollbar', async ({ page }) => {
  await open(page, 1920, 1200);
  // The board follows the reset files a moment later; the fixture's lanes are measured once they are shown.
  await expect(page.locator('.lane__cards').nth(2).locator('.card')).toHaveCount(2);
  for (const index of [0, 1, 2]) {
    const lane = await cue(page, index);
    expect(lane.more).toBe('false');
    expect(lane.bar).toBe(0);
  }
});

// ---------------------------------------------------------------- AC-4

test('1280px: the handle is a vertical separator and the drag stops at the limits', async ({ page }) => {
  await open(page, 1280);
  await expect(handle(page)).toHaveAttribute('aria-orientation', 'vertical');
  expect(await panelWidth(page)).toBe(360);

  await dragBy(page, -2000);
  expect(await panelWidth(page)).toBe(560);
  const lanes = await page.locator('.lane').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  for (const w of lanes) expect(w).toBeGreaterThanOrEqual(200);

  await dragBy(page, 2000);
  expect(await panelWidth(page)).toBe(280);

  await dragBy(page, -200);
  expect(await panelWidth(page)).toBe(480);
});

test('1440px: the widest panel is 560px', async ({ page }) => {
  await open(page, 1440);
  await dragBy(page, -2000);
  expect(await panelWidth(page)).toBe(560);
});

test('a touch pointer drags the handle too', async ({ page }) => {
  await open(page, 1280);
  const cdp = await page.context().newCDPSession(page);
  const h = await box(handle(page));
  const y = h.y + h.height / 2;
  const x = h.x + h.width / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 20 * i, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => panelWidth(page)).toBe(480);
});

test('1280px then 1024px: the width follows the limit and returns', async ({ page }) => {
  await open(page, 1280);
  await dragBy(page, -140);
  expect(await panelWidth(page)).toBe(500);
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect.poll(() => panelWidth(page)).toBe(344);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => panelWidth(page)).toBe(500);
});

test('dragging keeps the selection and the archive confirmation and selects no text', async ({ page }) => {
  await open(page, 1280);
  await task(page, 8).click();
  await panel(page).getByRole('button', { name: 'Archive task' }).click();
  const confirm = panel(page).getByRole('group', { name: /^Archive #8/ });
  await expect(confirm).toBeVisible();

  const h = await box(handle(page));
  const y = h.y + h.height / 2;
  await page.mouse.move(h.x + h.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 100, y, { steps: 6 });
  expect(await page.evaluate(() => String(getSelection()))).toBe('');
  await page.mouse.up();

  expect(await panelWidth(page)).toBe(460);
  await expect(confirm).toBeVisible();
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Initialize the board');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
});

test('Japanese: the handle is named in Japanese', async ({ page }) => {
  await open(page, 1280);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: '日本語' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('separator', { name: 'タスクの詳細の幅を変更' })).toBeVisible();
});

// ---------------------------------------------------------------- AC-5

test('the dragged width is stored and survives a reload', async ({ page }) => {
  await open(page, 1280);
  await dragBy(page, -120);
  expect(await panelWidth(page)).toBe(480);
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('480');
  await page.reload();
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
  expect(await panelWidth(page)).toBe(480);
});

for (const stored of ['abc', '600', '279']) {
  test(`a stored width of ${stored} falls back to 360px`, async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, stored] as const,
    );
    await open(page, 1280);
    expect(await panelWidth(page)).toBe(360);
  });
}

test('when storing fails the page keeps the dragged width and a reload opens at 360px', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('denied', 'QuotaExceededError');
    };
  });
  await open(page, 1280);
  await dragBy(page, -120);
  expect(await panelWidth(page)).toBe(480);
  await page.reload();
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
  expect(await panelWidth(page)).toBe(360);
});

// ---------------------------------------------------------------- AC-6 evidence

test('evidence screenshots at 1280x900', async ({ page }, testInfo) => {
  fillDone(3);
  await open(page, 1280);
  await task(page, 8).click();
  await page.locator('.lane__cards').nth(2).evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: testInfo.outputPath('scroll-cue.png') });
  await dragBy(page, -120);
  await page.mouse.move(300, 860);
  await page.screenshot({ path: testInfo.outputPath('panel-widened.png') });
});
