import { editorValue, pasteMarkdown } from '../helpers/ui';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { agboardOk, listCards, mainProject, nextCardId, resetBoard, taskBody } from '../helpers/agboard';

// The settings dialog, the 24 color themes, the language, and the board operations that must keep
// working with them. The Rust serve on 7631 is real; only the browser storage and a few request
// failures are injected at the browser edge.

const ACCENTS = [
  'Blue',
  'Sky',
  'Cyan',
  'Teal',
  'Green',
  'Lime',
  'Yellow',
  'Orange',
  'Red',
  'Pink',
  'Purple',
  'Gray',
] as const;
type Accent = (typeof ACCENTS)[number];
type Mode = 'Light' | 'Dark';

// The accent of every theme (the color of the primary button) and the page background of each mode.
const ACCENT_RGB: Record<Mode, Record<Accent, string>> = {
  Light: {
    Blue: 'rgb(37, 99, 235)',
    Sky: 'rgb(2, 132, 199)',
    Cyan: 'rgb(8, 145, 178)',
    Teal: 'rgb(13, 148, 136)',
    Green: 'rgb(22, 163, 74)',
    Lime: 'rgb(101, 163, 13)',
    Yellow: 'rgb(202, 138, 4)',
    Orange: 'rgb(234, 88, 12)',
    Red: 'rgb(220, 38, 38)',
    Pink: 'rgb(219, 39, 119)',
    Purple: 'rgb(124, 58, 237)',
    Gray: 'rgb(71, 85, 105)',
  },
  Dark: {
    Blue: 'rgb(107, 154, 255)',
    Sky: 'rgb(77, 181, 240)',
    Cyan: 'rgb(60, 201, 224)',
    Teal: 'rgb(61, 203, 184)',
    Green: 'rgb(76, 201, 122)',
    Lime: 'rgb(163, 217, 74)',
    Yellow: 'rgb(240, 197, 49)',
    Orange: 'rgb(245, 154, 82)',
    Red: 'rgb(244, 124, 124)',
    Pink: 'rgb(244, 114, 182)',
    Purple: 'rgb(167, 139, 250)',
    Gray: 'rgb(148, 163, 184)',
  },
};
const PAGE_BG: Record<Mode, string> = { Light: 'rgb(246, 247, 249)', Dark: 'rgb(15, 19, 24)' };

const THEME_NAMES = (['Light', 'Dark'] as const).flatMap((mode) =>
  ACCENTS.map((accent) => ({ mode, accent, name: `${mode} ${accent}` })),
);
const JA_COLORS: Record<Accent, string> = {
  Blue: 'ブルー',
  Sky: 'スカイ',
  Cyan: 'シアン',
  Teal: 'ティール',
  Green: 'グリーン',
  Lime: 'ライム',
  Yellow: 'イエロー',
  Orange: 'オレンジ',
  Red: 'レッド',
  Pink: 'ピンク',
  Purple: 'パープル',
  Gray: 'グレー',
};

const THEME_KEY = 'agboard.theme';
const LOCALE_KEY = 'agboard.locale';

let pageErrors: string[] = [];

// Card IDs are never reused, so a card a test creates gets the number that is next after the reset.
let fresh = 0;

test.beforeEach(async ({ page }) => {
  resetBoard(mainProject);
  fresh = nextCardId(mainProject);
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

const synced = (page: Page) => page.getByRole('contentinfo').getByRole('status');
const lane = (page: Page, name: string) => page.getByRole('region', { name });
const card = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });
const details = (page: Page, name = 'Card details') => page.getByRole('complementary', { name });
const html = (page: Page) => page.locator('html');
// An open dialog makes the page behind it inert, so the header button is found by CSS then.
const addButtonBehindDialog = (page: Page) => page.locator('header button', { hasText: /^(Add card|カード追加)$/ });

/** Opens the board with the storage this test starts with (a new browser context: empty). */
async function openFresh(page: Page): Promise<void> {
  await page.goto('/');
  await expect(synced(page)).toHaveText(/^Synced/);
  expect(await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), [THEME_KEY, LOCALE_KEY])).toEqual([
    null,
    null,
  ]);
}

/** Opens the board after `script` has run before the page (it prepares the storage boundary). */
async function openWith(page: Page, script: () => void): Promise<void> {
  await page.addInitScript(script);
  await page.goto('/');
  await expect(synced(page)).toHaveText(/^Synced/);
}

async function openSettings(page: Page, name = 'Settings'): Promise<Locator> {
  await page.getByRole('button', { name }).click();
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** `withAddButton` is false on the loading and error screens, which have no Add card button. */
async function expectTheme(page: Page, mode: Mode, accent: Accent, withAddButton = true): Promise<void> {
  const root = html(page);
  await expect(root).toHaveAttribute('data-mode', mode.toLowerCase());
  await expect(root).toHaveAttribute('data-accent', accent.toLowerCase());
  await expect(root).toHaveClass(mode === 'Dark' ? /(^|\s)dark(\s|$)/ : /^(?!.*\bdark\b).*$/);
  await expect(root).toHaveCSS('color-scheme', mode.toLowerCase());
  await expect(page.locator('body')).toHaveCSS('background-color', PAGE_BG[mode]);
  if (withAddButton) {
    await expect(addButtonBehindDialog(page)).toHaveCSS('background-color', ACCENT_RGB[mode][accent]);
  }
}

const storedTheme = (page: Page) => page.evaluate((key) => localStorage.getItem(key), THEME_KEY);

/** Moves the card with a real drag to the target lane; the reason dialog opens. */
async function dragCardTo(page: Page, id: number, laneName: string): Promise<Locator> {
  const source = await card(page, id).boundingBox();
  const target = await lane(page, laneName).boundingBox();
  if (!source || !target) throw new Error('Could not measure the drag source and target.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 24, source.y + source.height / 2, { steps: 4 });
  await page.mouse.move(target.x + 100, target.y + 100, { steps: 12 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // dnd-kit keeps the source in a dropping animation briefly after the pointer is released.
  const dragged = page.locator('.card').filter({ hasText: new RegExp(`^#${id}(?!\\d)`) }).first();
  await expect(dragged).not.toHaveClass(/card--dragging/);
  return dialog;
}

// ------------------------------------------------------------------ Themes and the language

test('every one of the 24 themes applies at once, is saved, and survives a reload; then the language changes', async ({
  page,
}) => {
  await openFresh(page);
  await expectTheme(page, 'Light', 'Blue');
  // The settings button sits at the right end of the header.
  const header = page.getByRole('banner');
  const settingsBox = (await header.getByRole('button', { name: 'Settings' }).boundingBox())!;
  const headerBox = (await header.boundingBox())!;
  expect(settingsBox.x + settingsBox.width).toBeGreaterThan(headerBox.x + headerBox.width - 40);
  const dialog = await openSettings(page);

  // Each row of Light and Dark lists the same 12 colors in the same order, named by mode and color.
  const group = dialog.getByRole('radiogroup', { name: 'Color theme' });
  const tiles = group.getByRole('radio');
  await expect(tiles).toHaveCount(24);
  expect(await tiles.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')))).toEqual(
    THEME_NAMES.map(({ name }) => name),
  );
  await expect(dialog.getByRole('radio', { name: 'Light Blue' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog).toContainText('Changes apply immediately.');

  // Dark first, so that no theme is the one already in effect when it is chosen.
  const order = [...THEME_NAMES.filter(({ mode }) => mode === 'Dark'), ...THEME_NAMES.filter(({ mode }) => mode === 'Light')];
  for (const { mode, accent, name } of order) {
    const tile = dialog.getByRole('radio', { name, exact: true });
    await tile.click();
    // The choice shows at once, the dialog stays open, and exactly this tile is marked chosen.
    await expect(dialog).toBeVisible();
    await expect(tile).toHaveAttribute('aria-checked', 'true');
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(1);
    await expect(tile).toBeFocused();
    await expect(tile.locator('svg')).toBeVisible();
    await expectTheme(page, mode, accent);
    await expect(dialog).toContainText(name);
    expect(JSON.parse((await storedTheme(page))!)).toEqual({ mode: mode.toLowerCase(), accent: accent.toLowerCase() });
  }

  // Close with Escape on Dark Pink and keep working with the board.
  await dialog.getByRole('radio', { name: 'Dark Pink', exact: true }).click();
  await expectTheme(page, 'Dark', 'Pink');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();
  await expect(lane(page, 'Todo')).toBeVisible();
  await expectTheme(page, 'Dark', 'Pink');

  await page.reload();
  await expect(synced(page)).toHaveText(/^Synced/);
  await expectTheme(page, 'Dark', 'Pink');
  const reopened = await openSettings(page);
  await expect(reopened.getByRole('radio', { name: 'Dark Pink', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(group.getByRole('radio', { checked: true })).toHaveCount(1);

  // The language changes at once, keeps the dialog and the theme, and is saved.
  await reopened.getByRole('radio', { name: '日本語' }).click();
  await expect(html(page)).toHaveAttribute('lang', 'ja');
  const japanese = page.getByRole('dialog', { name: '設定' });
  await expect(japanese).toBeVisible();
  await expect(japanese.getByRole('radio', { name: '日本語' })).toHaveAttribute('aria-checked', 'true');
  await expect(japanese.getByRole('radio', { name: 'ダーク・ピンク' })).toHaveAttribute('aria-checked', 'true');
  await expect(japanese).toContainText('変更はすぐに適用され、保存されます。');
  expect(await page.evaluate((key) => localStorage.getItem(key), LOCALE_KEY)).toBe('ja');
  await expectTheme(page, 'Dark', 'Pink');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '設定' })).toBeFocused();

  await page.reload();
  await expect(synced(page)).toHaveText(/^同期済み/);
  await expect(html(page)).toHaveAttribute('lang', 'ja');
  await expectTheme(page, 'Dark', 'Pink');
});

test('the Japanese names of all 24 themes follow the same order', async ({ page }) => {
  await openFresh(page);
  const dialog = await openSettings(page);
  await dialog.getByRole('radio', { name: '日本語' }).click();
  const japanese = page.getByRole('dialog', { name: '設定' });
  const names = await japanese
    .getByRole('radiogroup', { name: 'カラーテーマ' })
    .getByRole('radio')
    .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
  expect(names).toEqual(
    THEME_NAMES.map(({ mode, accent }) => `${mode === 'Light' ? 'ライト' : 'ダーク'}・${JA_COLORS[accent]}`),
  );
  await japanese.getByRole('radio', { name: 'ダーク・イエロー' }).click();
  await expectTheme(page, 'Dark', 'Yellow');
  await expect(japanese).toContainText('ダーク・イエロー');
});

test('choosing the theme that is already in effect keeps it', async ({ page }) => {
  await openFresh(page);
  const dialog = await openSettings(page);
  await dialog.getByRole('radio', { name: 'Light Blue' }).click();
  await expect(dialog.getByRole('radio', { name: 'Light Blue' })).toHaveAttribute('aria-checked', 'true');
  await expectTheme(page, 'Light', 'Blue');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(synced(page)).toHaveText(/^Synced/);
  await expectTheme(page, 'Light', 'Blue');
});

// ------------------------------------------------------------------ Initial theme and the storage

test.describe('the first theme in an OS dark browser', () => {
  test.use({ colorScheme: 'dark' });

  const unusable: [string, string | null][] = [
    ['nothing saved', null],
    ['text that is not JSON', '{oops'],
    ['a theme without an accent', '{"mode":"dark"}'],
    ['a theme with an unknown accent', '{"mode":"dark","accent":"magenta"}'],
    ['a theme with an unknown mode', '{"mode":"sepia","accent":"red"}'],
    ['a JSON array', '["dark","red"]'],
    ['a JSON null', 'null'],
  ];
  for (const [label, stored] of unusable) {
    test(`${label} opens Light Blue, not the OS setting`, async ({ page }) => {
      expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await page.addInitScript(
        ([key, value]) => {
          if (value !== null) localStorage.setItem(key as string, value as string);
        },
        [THEME_KEY, stored] as const,
      );
      await page.goto('/');
      await expect(synced(page)).toHaveText(/^Synced/);
      expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await expectTheme(page, 'Light', 'Blue');
      await expect(lane(page, 'Doing')).toBeVisible();
      const dialog = await openSettings(page);
      await expect(dialog.getByRole('radio', { name: 'Light Blue' })).toHaveAttribute('aria-checked', 'true');
      await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(2);
    });
  }

  test('a saved theme is used even though the OS is dark', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '{"mode":"light","accent":"yellow"}'), THEME_KEY);
    await page.goto('/');
    await expect(synced(page)).toHaveText(/^Synced/);
    await expectTheme(page, 'Light', 'Yellow');
  });
});

test.describe('the first theme in an OS light browser', () => {
  test.use({ colorScheme: 'light' });

  test('a saved dark theme is used', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '{"mode":"dark","accent":"red"}'), THEME_KEY);
    await page.goto('/');
    await expect(synced(page)).toHaveText(/^Synced/);
    await expectTheme(page, 'Dark', 'Red');
    await expect(html(page)).toHaveAttribute('lang', 'en');
  });
});

test.describe('a storage that fails', () => {
  test.use({ colorScheme: 'dark' });

  test('reading the saved theme throws: the page opens Light Blue and the board works', async ({ page }) => {
    await openWith(page, () => {
      const read = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        if (key === 'agboard.theme') throw new DOMException('denied', 'SecurityError');
        return read.call(this, key);
      };
    });
    await expectTheme(page, 'Light', 'Blue');
    await expect(card(page, 12)).toBeVisible();
  });

  test('saving the theme throws: the choice still applies to this page and the next page falls back', async ({
    page,
  }) => {
    await openWith(page, () => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'agboard.theme') throw new DOMException('full', 'QuotaExceededError');
        return write.call(this, key, value);
      };
    });
    const dialog = await openSettings(page);
    await dialog.getByRole('radio', { name: 'Dark Purple' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Dark Purple' })).toHaveAttribute('aria-checked', 'true');
    await expectTheme(page, 'Dark', 'Purple');
    expect(await storedTheme(page)).toBeNull();
    // The language is a different key and still saves.
    await dialog.getByRole('radio', { name: '日本語' }).click();
    await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '設定' }).getByRole('radio', { name: 'ダーク・パープル' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), LOCALE_KEY)).toBe('ja');
    await page.keyboard.press('Escape');
    await expectTheme(page, 'Dark', 'Purple');

    await page.reload();
    await expect(synced(page)).toHaveText(/^同期済み/);
    await expectTheme(page, 'Light', 'Blue');
  });

  test('the whole storage is unavailable: theme and language still apply while the page is open', async ({ page }) => {
    await openWith(page, () => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('denied', 'SecurityError');
        },
      });
    });
    await expectTheme(page, 'Light', 'Blue');
    const dialog = await openSettings(page);
    await dialog.getByRole('radio', { name: 'Dark Orange' }).click();
    await expectTheme(page, 'Dark', 'Orange');
    await dialog.getByRole('radio', { name: '日本語' }).click();
    await expect(html(page)).toHaveAttribute('lang', 'ja');
    const japanese = page.getByRole('dialog', { name: '設定' });
    await expect(japanese.getByRole('radio', { name: 'ダーク・オレンジ' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectTheme(page, 'Dark', 'Orange');
    await card(page, 12).click();
    await expect(details(page, 'カードの詳細').getByRole('heading', { level: 2 })).toHaveText('Restore a board from JSON');
  });
});

// ------------------------------------------------------------------ Settings while loading or failing

test('the settings stay available while the board loads and when it cannot load', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failing = false;
  await page.route('**/api/projects/*/board', async (route) => {
    await gate;
    if (failing) await route.fulfill({ status: 500, body: 'boom' });
    else await route.fallback();
  });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.getByText('Loading board…')).toBeVisible();
  // While loading there is no board, so no board name or Add card; the settings are there.
  await expect(page.getByRole('button', { name: 'Add card' })).toHaveCount(0);
  const dialog = await openSettings(page);
  await dialog.getByRole('radio', { name: 'Dark Teal' }).click();
  await expectTheme(page, 'Dark', 'Teal', false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();

  failing = true;
  release();
  await expect(page.getByRole('alert')).toContainText('Could not load this board.');
  await expect(page.getByRole('button', { name: 'Add card' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('Not synced');
  // The theme chosen while loading is still in effect, and can be changed on the error screen.
  await expectTheme(page, 'Dark', 'Teal', false);
  const errorDialog = await openSettings(page);
  await errorDialog.getByRole('radio', { name: 'Light Red' }).click();
  await expect(errorDialog).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color', PAGE_BG.Light);
  await page.keyboard.press('Escape');

  failing = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(card(page, 12)).toBeVisible();
  await expect(addButtonBehindDialog(page)).toHaveCSS('background-color', ACCENT_RGB.Light.Red);
  await expect(page.getByRole('button', { name: 'Add card' })).toBeVisible();
});

// ------------------------------------------------------------------ Focus

test('the settings dialog takes the focus, keeps it inside, and gives it back', async ({ page }) => {
  await openFresh(page);
  const settingsButton = page.getByRole('button', { name: 'Settings' });
  await settingsButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  // The focus goes to the chosen language, and the board behind is not reachable.
  await expect(dialog.getByRole('radio', { name: 'English' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Add card' })).toHaveCount(0);
  await expect(page.getByRole('region')).toHaveCount(0);

  // Tab and Shift+Tab wrap around inside the dialog.
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }

  // Escape closes the dialog and the focus goes back to the button that opened it.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(settingsButton).toBeFocused();

  // So does the close button.
  await settingsButton.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(settingsButton).toBeFocused();

  // The arrow keys move between the themes while holding the key (the group selects on it).
  await settingsButton.click();
  await dialog.getByRole('radio', { name: 'Light Blue' }).focus();
  await page.keyboard.press('ArrowRight', { delay: 60 });
  await expect(dialog.getByRole('radio', { name: 'Light Sky' })).toBeFocused();
  await expect(dialog.getByRole('radio', { name: 'Light Sky' })).toHaveAttribute('aria-checked', 'true');
  await expectTheme(page, 'Light', 'Sky');
  await page.keyboard.press('Escape');
});

test('Add card takes the focus to the title, keeps it inside, and gives it back; the input survives a click outside', async ({
  page,
}) => {
  await openFresh(page);
  const add = page.getByRole('button', { name: 'Add card' });
  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add card' });
  await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }

  // Without a title there is nothing to add: the button stays disabled and the dialog stays.
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  // A click on the page behind does not close it or lose what was typed.
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Typed and kept');
  await page.mouse.click(4, 4);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Typed and kept');

  // The typed title is unsaved, so Escape asks first; Discard and close then gives the focus back.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard and close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  expect(listCards(mainProject).map(({ title }) => title)).not.toContain('Typed and kept');

  // Cancel and the close button also give the focus back.
  await add.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(add).toBeFocused();
  await add.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(add).toBeFocused();
});

test('the move dialog and the answer dialog take the focus and give it back', async ({ page }) => {
  await openFresh(page);
  const move = await dragCardTo(page, 16, 'Doing');
  await expect(move).toContainText('Move card');
  await expect(move.getByRole('textbox', { name: 'Reason (required)' })).toBeFocused();
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(move).toHaveCount(0);
  // Nothing moved, and the focus is on the card that was dragged.
  await expect(card(page, 16)).toBeFocused();
  expect(listCards(mainProject).find(({ id }) => id === 16)?.cardStatus).toBe('todo');

  await card(page, 12).click();
  // The answer is typed in place, not in a dialog: the form is open with the request, and its text area takes focus.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const answerBox = details(page).getByRole('textbox', { name: 'Your answer' });
  await answerBox.click();
  await expect(answerBox).toBeFocused();
  await details(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(answerBox).toHaveValue('');
  expect(listCards(mainProject).find(({ id }) => id === 12)?.agentStatus).toBe('pending');
});

test('while a card is being saved the dialog cannot be submitted again or closed', async ({ page }) => {
  await openFresh(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route('**/api/projects/*/cards', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts += 1;
    await gate;
    return route.fallback();
  });
  await page.getByRole('button', { name: 'Add card' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add card' });
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Saved once');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();

  const saving = dialog.getByRole('button', { name: 'Saving…' });
  await expect(saving).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.click(4, 4);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  expect(posts).toBe(1);

  release();
  await expect(dialog).toHaveCount(0);
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${fresh} AI Saved once `) })).toBeVisible();
  expect(posts).toBe(1);
  expect(listCards(mainProject).filter(({ title }) => title === 'Saved once')).toHaveLength(1);
});

// ------------------------------------------------------------------ The language never changes the data

test('changing the language does not translate or alter what was entered', async ({ page }) => {
  await openFresh(page);
  // Enter a card in English, move it with a reason, and answer a decision request.
  await page.getByRole('button', { name: 'Add card' }).click();
  const create = page.getByRole('dialog', { name: 'Add card' });
  await create.getByRole('textbox', { name: 'Title', exact: true }).fill('Draft the release note');
  await pasteMarkdown(create.getByRole('textbox', { name: 'Description (Markdown)' }), taskBody('Line one\n\nLine two'));
  await create.getByRole('radio', { name: 'User' }).click();
  await create.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${fresh} User Draft the release note `) })).toBeVisible();
  const move = await dragCardTo(page, fresh, 'Doing');
  await move.getByRole('textbox', { name: 'Reason (required)' }).fill('Starting the draft today.');
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(lane(page, 'Doing').getByRole('button', { name: new RegExp(`^#${fresh} `) })).toBeVisible();
  await card(page, 12).click();
  const answer = details(page);
  await answer.getByRole('textbox', { name: 'Your answer' }).fill('Keep the database name.');
  await answer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card(page, 12)).toContainText('Idle');

  const before = listCards(mainProject);
  const dialog = await openSettings(page);
  await dialog.getByRole('radio', { name: '日本語' }).click();
  await page.keyboard.press('Escape');
  await expect(html(page)).toHaveAttribute('lang', 'ja');

  // The interface is Japanese; the entered text is exactly as typed.
  await expect(lane(page, '進行中')).toBeVisible();
  const entered = card(page, fresh);
  await expect(entered).toContainText('Draft the release note');
  await entered.click();
  const panel = details(page, 'カードの詳細');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Draft the release note');
  await expect(panel.getByText('Line one')).toBeVisible();
  expect(await panel.getByText('Line one').evaluate((element) => (element as HTMLElement).innerText)).toBe('Line one');
  await expect(panel.getByText('Line two')).toBeVisible();
  await panel.getByRole('tab', { name: '履歴 2' }).click();
  await expect(panel).toContainText('Starting the draft today.');
  await card(page, 12).click();
  await expect(panel).toContainText('Keep the database name.');
  expect(listCards(mainProject)).toEqual(before);

  // A card entered in Japanese mode is stored as typed too.
  await page.getByRole('button', { name: 'カード追加' }).click();
  const japaneseCreate = page.getByRole('dialog', { name: 'カードを追加' });
  await expect(japaneseCreate).toBeVisible();
  await japaneseCreate.getByRole('textbox', { name: 'タイトル', exact: true }).fill('Release note review');
  await japaneseCreate.getByRole('button', { name: '追加', exact: true }).click();
  await expect(lane(page, '未着手').getByRole('button', { name: new RegExp(`^#${fresh + 1} `) })).toContainText('Release note review');
  expect(listCards(mainProject).find(({ id }) => id === fresh + 1)?.title).toBe('Release note review');
});

// ------------------------------------------------------------------ The board operations with a chosen theme

test('create, move with a reason, answer, archive, and live updates work with a chosen theme', async ({ page }) => {
  await openFresh(page);
  const settings = await openSettings(page);
  await settings.getByRole('radio', { name: 'Dark Red' }).click();
  await expectTheme(page, 'Dark', 'Red');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { __opened: boolean }).__opened = true;
  });

  // Create.
  await page.getByRole('button', { name: 'Add card' }).click();
  const create = page.getByRole('dialog', { name: 'Add card' });
  await create.getByRole('textbox', { name: 'Title', exact: true }).fill('Review the themes');
  await pasteMarkdown(create.getByRole('textbox', { name: 'Description (Markdown)' }), taskBody('Check all 24 themes.'));
  await create.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(create).toHaveCount(0);
  const created = lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${fresh} AI Review the themes Updated \\d\\d\\/\\d\\d \\d\\d:\\d\\d$`) });
  await expect(created).toBeVisible();
  await expect(lane(page, 'Todo').getByText('4', { exact: true })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('9 cards');
  expect(listCards(mainProject).find(({ id }) => id === fresh)).toMatchObject({ title: 'Review the themes', cardStatus: 'todo', assignee: 'ai' });

  // Move with a reason by dragging; nothing changes until it is confirmed.
  const move = await dragCardTo(page, fresh, 'Doing');
  await expect(move.getByRole('group', { name: 'Status change' })).toHaveText(/Todo\s*Doing/);
  expect(listCards(mainProject).find(({ id }) => id === fresh)?.cardStatus).toBe('todo');
  await move.getByRole('textbox', { name: 'Reason (required)' }).fill('Starting the review.');
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(lane(page, 'Doing').getByRole('button', { name: new RegExp(`^#${fresh} AI Idle Review the themes `) })).toBeVisible();
  await card(page, fresh).click();
  await details(page).getByRole('tab', { name: /^History/ }).click();
  await expect(details(page).getByRole('listitem').first()).toContainText('Starting the review.');
  expect(listCards(mainProject).find(({ id }) => id === fresh)).toMatchObject({ cardStatus: 'doing' });

  // Answer a decision request; the run state goes back to Idle and the answer is in the history.
  await card(page, 12).click();
  const panel = details(page);
  await expect(panel).toContainText('Pending');
  const answer = panel.getByRole('region', { name: 'The agent is waiting for your answer' });
  await answer.getByRole('textbox', { name: 'Your answer' }).fill('Replace the board after a backup.');
  await answer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(answer).toHaveCount(0);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#12 AI Idle Restore a board from JSON / })).toBeVisible();
  await panel.getByRole('tab', { name: /^History/ }).click();
  await expect(panel.getByRole('listitem').first()).toContainText('Replace the board after a backup.');
  await expect(panel.getByRole('region', { name: 'The agent is waiting for your answer' })).toHaveCount(0);
  expect(listCards(mainProject).find(({ id }) => id === 12)).toMatchObject({ agentStatus: 'idle', pendingReason: null });

  // Archive from the toolbar beside the tabs; Cancel keeps the card, Archive removes it from the board.
  await card(page, fresh).click();
  await panel.getByRole('button', { name: 'Archive card' }).click();
  const confirm = panel.getByRole('group', { name: `Archive #${fresh} "Review the themes"? You can restore it from the archive.` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(listCards(mainProject).map(({ id }) => id)).toContain(fresh);
  await panel.getByRole('button', { name: 'Archive card' }).click();
  await panel.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(panel).toContainText('Select a card to see its details.');
  await expect(card(page, fresh)).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toContainText('8 cards');
  expect(listCards(mainProject).map(({ id }) => id)).not.toContain(fresh);

  // Changes made outside the page arrive without a reload (server-sent events).
  agboardOk(mainProject, ['add', 'Added by the CLI', '--desc', 'Live']);
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${fresh + 1} AI Added by the CLI `) })).toBeVisible();
  agboardOk(mainProject, ['mv', String(fresh + 1), 'doing']);
  await expect(lane(page, 'Doing').getByRole('button', { name: new RegExp(`^#${fresh + 1} AI Idle Added by the CLI `) })).toBeVisible();
  agboardOk(mainProject, ['state', String(fresh + 1), 'running']);
  await expect(lane(page, 'Doing').getByRole('button', { name: new RegExp(`^#${fresh + 1} AI Running Added by the CLI `) })).toBeVisible();
  agboardOk(mainProject, ['state', String(fresh + 1), 'pending', '--reason', 'Waiting for a theme review']);
  await expect(lane(page, 'Doing').getByRole('button', { name: new RegExp(`^#${fresh + 1} AI Pending Added by the CLI `) })).toContainText(
    'Waiting for a theme review',
  );
  // The pending state keeps its own amber, apart from the Red accent.
  const pendingBadge = lane(page, 'Doing').getByRole('button', { name: new RegExp(`^#${fresh + 1} AI Pending `) }).locator('.status-label');
  await expect(pendingBadge).toHaveCSS('color', 'rgb(233, 176, 79)');
  expect(await page.evaluate(() => (window as unknown as { __opened?: boolean }).__opened)).toBe(true);
  // The theme was not lost along the way.
  await expectTheme(page, 'Dark', 'Red');
});

// ------------------------------------------------------------------ A failing request keeps the input

test('a request that fails keeps what was typed, shows the reason, and can be sent again', async ({ page }) => {
  await openFresh(page);
  let mode: 'reject' | 'abort' | 'pass' = 'reject';
  await page.route('**/api/projects/*/cards', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    if (mode === 'abort') return route.abort('failed');
    if (mode === 'reject') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { reason: 'The storage is busy.' } }),
      });
    }
    return route.fallback();
  });

  await page.getByRole('button', { name: 'Add card' }).click();
  const create = page.getByRole('dialog', { name: 'Add card' });
  await create.getByRole('textbox', { name: 'Title', exact: true }).fill('Typed title');
  await pasteMarkdown(create.getByRole('textbox', { name: 'Description (Markdown)' }), taskBody('Typed description\n\nsecond line'));
  await create.getByRole('radio', { name: 'User' }).click();
  await create.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(create.getByRole('alert')).toContainText('Could not save. Your input is kept. Try again.');
  await expect(create.getByRole('alert')).not.toContainText('The storage is busy.');
  const keepsInput = async () => {
    await expect(create).toBeVisible();
    await expect(create.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Typed title');
    expect(await editorValue(create.getByRole('textbox', { name: 'Description (Markdown)' }))).toContain('Typed description\n\nsecond line');
    await expect(create.getByRole('radio', { name: 'User' })).toHaveAttribute('aria-checked', 'true');
    await expect(create.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
    await expect(create.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  };
  await keepsInput();
  expect(listCards(mainProject).map(({ title }) => title)).not.toContain('Typed title');

  mode = 'abort';
  await create.getByRole('button', { name: 'Add', exact: true }).click();
  // A request that never reached the server has no reason of its own: the dialog's own message shows.
  await expect(create.getByRole('alert')).toContainText('Could not save. Your input is kept. Try again.');
  await keepsInput();

  mode = 'pass';
  await create.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(create).toHaveCount(0);
  await expect(lane(page, 'Todo').getByRole('button', { name: new RegExp(`^#${fresh} User Typed title `) })).toBeVisible();
  expect(listCards(mainProject).filter(({ title }) => title === 'Typed title')).toHaveLength(1);

  // Moving: a refused move keeps the reason and the card where it was.
  let moveFails = true;
  await page.route('**/api/projects/*/cards/16/move', async (route) => {
    if (!moveFails) return route.fallback();
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { reason: 'The move was refused.' } }),
    });
  });
  const move = await dragCardTo(page, 16, 'Doing');
  await move.getByRole('textbox', { name: 'Reason (required)' }).fill('Kept reason.');
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(move.getByRole('alert')).toHaveText('The move was refused.');
  await expect(move.getByRole('textbox', { name: 'Reason (required)' })).toHaveValue('Kept reason.');
  expect(listCards(mainProject).find(({ id }) => id === 16)?.cardStatus).toBe('todo');
  moveFails = false;
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(move).toHaveCount(0);
  await expect(lane(page, 'Doing').getByRole('button', { name: /^#16 / })).toBeVisible();

  // Answering: a refused answer keeps the text, and the card stays pending.
  let answerFails = true;
  await page.route('**/api/projects/*/cards/12/answer', async (route) => {
    if (!answerFails) return route.fallback();
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { reason: 'The request was already answered.' } }),
    });
  });
  await card(page, 12).click();
  const answer = details(page).getByRole('region', { name: 'The agent is waiting for your answer' });
  await answer.getByRole('textbox', { name: 'Your answer' }).fill('Kept answer.');
  await answer.getByRole('button', { name: 'Send', exact: true }).click();
  // The in-place answer shows the board's fixed save-failure text rather than the server's reason.
  await expect(answer.getByRole('alert')).toHaveText('Could not save. Try again.');
  await expect(answer.getByRole('textbox', { name: 'Your answer' })).toHaveValue('Kept answer.');
  expect(listCards(mainProject).find(({ id }) => id === 12)?.agentStatus).toBe('pending');
  answerFails = false;
  await answer.getByRole('button', { name: /^(Send|Retry)$/ }).click();
  await expect(answer).toHaveCount(0);
  expect(listCards(mainProject).find(({ id }) => id === 12)?.agentStatus).toBe('idle');
});

test('an archive that fails keeps the card, the selection, and the confirmation', async ({ page }) => {
  agboardOk(mainProject, ['add', 'Disposable card']);
  await openFresh(page);
  let fails = true;
  await page.route(`**/api/projects/*/cards/${fresh}/archive`, async (route) => {
    if (route.request().method() !== 'POST' || !fails) return route.fallback();
    return route.fulfill({ status: 500, body: 'no' });
  });
  await card(page, fresh).click();
  const panel = details(page);
  await panel.getByRole('button', { name: 'Archive card' }).click();
  await panel.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('Could not archive the card. Try again.');
  await expect(panel.getByRole('group', { name: `Archive #${fresh} "Disposable card"? You can restore it from the archive.` })).toBeVisible();
  await expect(card(page, fresh)).toHaveAttribute('aria-current', 'true');
  expect(listCards(mainProject).map(({ id }) => id)).toContain(fresh);

  fails = false;
  await panel.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(card(page, fresh)).toHaveCount(0);
  await expect(panel).toContainText('Select a card to see its details.');
  expect(listCards(mainProject).map(({ id }) => id)).not.toContain(fresh);
});

// ------------------------------------------------------------------ Screenshots in the order of use

/** Where the screenshots go: the test output, and a folder named by E2E_SCREENSHOT_DIR when set. */
function shotPaths(testInfo: TestInfo, name: string): string[] {
  const paths = [testInfo.outputPath(name)];
  const extra = process.env.E2E_SCREENSHOT_DIR;
  if (extra) {
    mkdirSync(extra, { recursive: true });
    paths.push(path.join(extra, name));
  }
  return paths;
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const [first, ...rest] = shotPaths(testInfo, name);
  // Let the dialog's open and close transitions finish; the endless spinner is left alone.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const image = await page.screenshot({ path: first });
  for (const target of rest) writeFileSync(target, image);
}

test('screenshots of the settings, the light and dark boards, yellow and red, and the states', async ({
  page,
}, testInfo) => {
  agboardOk(mainProject, ['add', 'Disposable card']);
  await openFresh(page);
  await shot(page, testInfo, '01-board-light-blue.png');
  await card(page, 12).click();
  await shot(page, testInfo, '02-pending-selected-light-blue.png');
  const dialog = await openSettings(page);
  await shot(page, testInfo, '03-settings-light-blue.png');

  await dialog.getByRole('radio', { name: 'Dark Blue' }).click();
  await expectTheme(page, 'Dark', 'Blue');
  await shot(page, testInfo, '04-settings-dark-blue.png');
  await page.keyboard.press('Escape');
  await shot(page, testInfo, '05-board-dark-blue.png');

  for (const [mode, accent] of [
    ['Light', 'Yellow'],
    ['Dark', 'Red'],
  ] as const) {
    const open = await openSettings(page);
    await open.getByRole('radio', { name: `${mode} ${accent}`, exact: true }).click();
    await expectTheme(page, mode, accent);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await shot(page, testInfo, `06-board-${mode.toLowerCase()}-${accent.toLowerCase()}.png`);
  }

  // The dialogs, in Dark Red.
  await page.getByRole('button', { name: 'Add card' }).click();
  await shot(page, testInfo, '07-create-dark-red.png');
  await page.keyboard.press('Escape');
  const move = await dragCardTo(page, 16, 'Doing');
  await shot(page, testInfo, '08-move-dark-red.png');
  void move;
  await page.keyboard.press('Escape');
  await shot(page, testInfo, '09-answer-dark-red.png');
  await page.keyboard.press('Escape');

  // The archive confirmation and its failure.
  await card(page, fresh).click();
  await details(page).getByRole('button', { name: 'Archive card' }).click();
  await shot(page, testInfo, '10-archive-confirm-dark-red.png');
  await page.route(`**/api/projects/*/cards/${fresh}/archive`, (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 500, body: 'no' }) : route.fallback(),
  );
  await details(page).getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(details(page).getByRole('alert')).toBeVisible();
  await shot(page, testInfo, '11-archive-failed-dark-red.png');
  await page.unroute(`**/api/projects/*/cards/${fresh}/archive`);

  // Loading and error states in the same theme.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failing = false;
  await page.route('**/api/projects/*/board', async (route) => {
    await gate;
    if (failing) await route.fulfill({ status: 500, body: 'boom' });
    else await route.fallback();
  });
  await page.reload({ waitUntil: 'commit' });
  await expect(page.getByText('Loading board…')).toBeVisible();
  await shot(page, testInfo, '12-loading-dark-red.png');
  failing = true;
  release();
  await expect(page.getByRole('alert')).toContainText('Could not load this board.');
  await shot(page, testInfo, '13-load-error-dark-red.png');
});
