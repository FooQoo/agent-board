import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetBoard, agboardOk } from '../helpers/agboard';

// Headless Chromium hides scrollbars by default; the scroll cue needs the real ones.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

const STORAGE_KEY = 'skan.detailWidth';

test.beforeEach(() => {
  resetBoard();
});

async function open(page: Page, width: number, height = 900): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(page.getByRole('contentinfo').getByRole('status')).toHaveText(/^Synced/);
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Card details' });
const handle = (page: Page) => page.getByRole('separator', { name: 'Resize card details' });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

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

function fillDone(extra = 8): void {
  for (let i = 0; i < extra; i += 1) agboardOk(['add', `Extra done card ${i + 1}`]);
  const cards = JSON.parse(agboardOk(['ls', '--json']).stdout).cards as { id: number; title: string }[];
  for (const c of cards.filter((x) => x.title.startsWith('Extra done card'))) agboardOk(['mv', String(c.id), 'done']);
}

// ---------------------------------------------------------------- Desktop layout

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
    await card(page, 8).click();
    await expect(panel(page).getByRole('button', { name: 'Close details' })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Close details' }).click();
    await expect(panel(page).getByText('Select a card to see its details.')).toBeVisible();
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

test('1920px: a lane that fits its cards shows neither fade nor scrollbar', async ({ page }) => {
  await open(page, 1920, 1200);
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

test('dragging keeps the selection and the delete confirmation and selects no text', async ({ page }) => {
  await open(page, 1280);
  await card(page, 8).click();
  await panel(page).getByRole('button', { name: 'Delete card' }).click();
  const confirm = panel(page).getByRole('group', { name: /^Delete #8/ });
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
  await expect(page.getByRole('separator', { name: 'カードの詳細の幅を変更' })).toBeVisible();
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
  await card(page, 8).click();
  await page.locator('.lane__cards').nth(2).evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: testInfo.outputPath('scroll-cue.png') });
  await dragBy(page, -120);
  await page.mouse.move(300, 860);
  await page.screenshot({ path: testInfo.outputPath('panel-widened.png') });
});
