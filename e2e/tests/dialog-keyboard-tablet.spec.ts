import { expect, test } from '../helpers/fixtures';
import { mainProject, resetBoard } from '../helpers/agboard';
import { resetPreferences } from '../helpers/preferences';
import { openAskAi } from '../helpers/ask-ai';
import { answerNote, openAnswer } from '../helpers/answer';
import type { Locator, Page } from '@playwright/test';

const details = (page: Page) => page.getByRole('complementary', { name: 'Task details' });
const task = (page: Page, id: number) => page.getByRole('button', { name: new RegExp(`^#${id}(?!\\d)`) });

// iPad-sized touch screens, wide enough for the PC layout, so dialogs are centered, not sheets. The
// landscape one is how a tablet is mostly held and leaves the least height above the keyboard.
const screens = [
  { name: 'landscape', width: 1180, height: 820, keyboard: 420 },
  { name: 'portrait', width: 820, height: 1180, keyboard: 340 },
  // A smaller iPad in landscape with the keyboard's shortcut bar: about 170px stay above it.
  { name: 'small landscape', width: 1000, height: 700, keyboard: 530 },
] as const;

// Two lines of the 16px text, which the field keeps even in the smallest strip above the keyboard.
const minFieldHeight = 48;

async function openTaskEditor(page: Page): Promise<Locator> {
  await task(page, 14).click();
  await details(page).getByRole('button', { name: 'Open full screen (task)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^#14 / });
  await expect(dialog).toBeVisible();
  return dialog;
}

// Every dialog a person types into on the board.
const dialogs: {
  name: string;
  open: (page: Page) => Promise<Locator>;
  submit: string;
  field: (dialog: Locator, page: Page) => Locator;
  /** The box the field scrolls in, when it is not the field itself. */
  area?: (dialog: Locator) => Locator;
}[] = [
  { name: 'Ask AI', open: openAskAi, submit: 'Send request', field: (d) => d.getByRole('textbox').first() },
  { name: 'answer', open: (page) => openAnswer(page), submit: 'Send answer', field: (_d, page) => answerNote(page) },
  {
    name: 'task editor',
    open: openTaskEditor,
    submit: 'Save',
    field: (d) => d.getByRole('textbox', { name: 'Description (Markdown)' }),
    area: (d) => d.locator('.editor__box'),
  },
];

// Positions are compared with 2px of room for subpixel rounding.
const tolerance = 2;

type Keyboard = { setKeyboard: (height: number) => void };

for (const screen of screens) {
  test.describe(screen.name, () => {
    test.use({ viewport: { width: screen.width, height: screen.height }, hasTouch: true });

    test.afterEach(() => resetPreferences());

    test.beforeEach(async ({ page }) => {
      resetBoard(mainProject);
      await resetPreferences();
      // iOS Safari leaves the layout viewport at full height and only shrinks the visual viewport when
      // the keyboard opens; a stand-in for it lets the test play that.
      await page.addInitScript(() => {
        const target = new EventTarget();
        const state = { shrink: 0 };
        const root = () => document.documentElement;
        const fake = Object.defineProperties(target, {
          height: { get: () => root().clientHeight - state.shrink },
          width: { get: () => root().clientWidth },
          offsetTop: { value: 0 },
          offsetLeft: { value: 0 },
          pageLeft: { value: 0 },
          pageTop: { get: () => window.scrollY },
          scale: { value: 1 },
        });
        Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
        (window as unknown as Keyboard).setKeyboard = (height) => {
          state.shrink = height;
          target.dispatchEvent(new Event('resize'));
        };
      });
      await page.goto('/');
      await expect(page.getByRole('region', { name: 'Messages' })).toBeVisible();
    });

    for (const { name, open, submit, field: fieldOf, area } of dialogs) {
      test(`the ${name} dialog keeps its header and submit button above the keyboard`, async ({ page }) => {
        const dialog = await open(page);
        const button = dialog.getByRole('button', { name: submit, exact: true });
        await expect(button).toBeVisible();
        const limit = screen.height - screen.keyboard;
        // A smaller visual viewport with no text field focused (a pinch zoom, a toolbar) is no keyboard:
        // the dialog stays centered.
        await page.evaluate((height) => (window as unknown as Keyboard).setKeyboard(height), screen.keyboard);
        await expect(page.locator('html')).not.toHaveAttribute('data-visual-keyboard', '');
        // The keyboard opens for a focused text field.
        const typed = fieldOf(dialog, page);
        await typed.focus();
        await expect(page.locator('html')).toHaveAttribute('data-visual-keyboard', '');
        if (process.env.AB_SHOTS) {
          await page.waitForTimeout(600);
          await page.screenshot({ path: `${process.env.AB_SHOTS}/${screen.name}-${name}.png` });
        }
        await expect
          .poll(async () => {
            const box = await button.boundingBox();
            return box ? box.y + box.height : Infinity;
          })
          .toBeLessThanOrEqual(limit + tolerance);
        const box = await dialog.boundingBox();
        if (!box) throw new Error('The dialog did not render.');
        expect(box.y).toBeGreaterThanOrEqual(-tolerance);
        expect(box.y + box.height).toBeLessThanOrEqual(limit + tolerance);
        await expect(dialog.getByRole('button', { name: 'Close', exact: true }).first()).toBeInViewport({ ratio: 1 });
        // The field being typed in keeps a few lines in sight between the header and the footer.
        await expect
          .poll(async () => {
            const [field, footer, frame] = await Promise.all([(area ? area(dialog) : typed).boundingBox(), button.boundingBox(), dialog.boundingBox()]);
            if (!field || !footer || !frame) return 0;
            return Math.min(field.y + field.height, footer.y) - Math.max(field.y, frame.y);
          })
          .toBeGreaterThanOrEqual(minFieldHeight);

        await page.evaluate(() => (window as unknown as Keyboard).setKeyboard(0));
        await expect(page.locator('html')).not.toHaveAttribute('data-visual-keyboard', '');
      });
    }
  });
}
