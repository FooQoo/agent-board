import { expect, test } from '../helpers/fixtures';
import { mainProject, resetBoard } from '../helpers/agboard';
import { resetPreferences } from '../helpers/preferences';
import { openAskAi } from '../helpers/ask-ai';

// iPad-sized touch screens, wide enough for the PC layout, so dialogs are centered, not sheets. The
// landscape one is how a tablet is mostly held and leaves the least height above the keyboard.
const screens = [
  { name: 'landscape', width: 1180, height: 820, keyboard: 420 },
  { name: 'portrait', width: 820, height: 1180, keyboard: 340 },
] as const;

const dialogs = [
  { name: 'Ask AI', open: openAskAi, submit: 'Send request' },
] as const;

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

    for (const { name, open, submit } of dialogs) {
      test(`the ${name} dialog keeps its header and submit button above the keyboard`, async ({ page }) => {
        const dialog = await open(page);
        const button = dialog.getByRole('button', { name: submit, exact: true });
        await expect(button).toBeVisible();
        const limit = screen.height - screen.keyboard;
        await page.evaluate((height) => (window as unknown as Keyboard).setKeyboard(height), screen.keyboard);
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
        await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport({ ratio: 1 });

        await page.evaluate(() => (window as unknown as Keyboard).setKeyboard(0));
        await expect(page.locator('html')).not.toHaveAttribute('data-visual-keyboard', '');
      });
    }
  });
}
