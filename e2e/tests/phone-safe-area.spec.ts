import { mainProject, resetBoard } from '../helpers/agboard';
import { expect, test } from '../helpers/fixtures';
import { resetPreferences, setPreferences } from '../helpers/preferences';

// The Home Screen app on an iPhone: a Dynamic Island model and a notched model. The browser reports no
// safe area, so each run sets the variables the page reads (see `--safe-top` in app.css) to the status
// bar the device would report.
const phones = [
  { name: 'Dynamic Island', width: 393, height: 852, top: 59, bottom: 34 },
  { name: 'notch', width: 390, height: 844, top: 47, bottom: 34 },
] as const;

for (const phone of phones) {
  for (const mode of ['light', 'dark'] as const) {
    test.describe(`${phone.name} ${phone.width}x${phone.height}, ${mode}`, () => {
      test.use({
        viewport: { width: phone.width, height: phone.height },
        hasTouch: true,
        isMobile: true,
        colorScheme: mode,
      });

      test.beforeEach(async () => {
        resetBoard(mainProject);
        await setPreferences({ locale: 'en', theme: { mode, accent: 'blue' } });
      });
      test.afterEach(() => resetPreferences());

      test('the header row stays below the status bar', async ({ page }) => {
        await page.goto('/');
        const header = page.locator('.monitor-shell > .header');
        await expect(header).toBeVisible();
        await page.addStyleTag({
          content: `:root { --safe-top: ${phone.top}px; --safe-bottom: ${phone.bottom}px; }`,
        });

        // The whole row, project name and sync status included, starts a gap below the bar.
        const box = await header.boundingBox();
        expect(box?.y ?? 0).toBeGreaterThanOrEqual(phone.top + 8);
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(phone.height);

        if (process.env.AB_SHOTS) {
          await page.screenshot({ path: `${process.env.AB_SHOTS}/safe-area-${phone.width}-${mode}.png` });
        }
      });
    });
  }
}
