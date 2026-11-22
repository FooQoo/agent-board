import { expect, test } from '@playwright/test';

// Mermaid diagrams on the documentation site. Mermaid sizes each label box (a foreignObject)
// from text it measured itself; Japanese text falls back to fonts with taller lines, so the
// rendered label is often taller than its box. The site lets labels draw past their box, so
// the bottom of a line is never cut off. This suite runs with the demo suite because both
// open the built site. Pages with only sequence diagrams have no label boxes and are left out.

// The site base is the demo base without its trailing demo/ folder.
const siteBase = (process.env.AGBOARD_DEMO_BASE ?? '/agent-board-draft/demo/').replace(/demo\/$/, '');

const pages = [
  'guide/',
  'guide/delegate/agents',
  'dev/',
  'dev/concepts/overview',
  'dev/concepts/notifications',
  'dev/concepts/remote-access',
  'dev/concepts/demo',
];

for (const width of [390, 1280]) {
  for (const locale of ['', 'ja/']) {
    for (const page of pages) {
      const path = `${siteBase}${locale}${page}`;
      test(`Mermaid labels are not clipped at ${width}px: ${path}`, async ({ page: browserPage }) => {
        await browserPage.setViewportSize({ width, height: 900 });
        await browserPage.goto(path);
        // Wait until every diagram on the page has rendered, and for the page fonts, which
        // change the label sizes. The plugin first draws an error placeholder, then the diagram.
        const diagrams = browserPage.locator('.vp-doc .mermaid');
        await expect(diagrams.first()).toBeVisible();
        await browserPage.waitForFunction(() =>
          [...document.querySelectorAll('.vp-doc .mermaid')].every((diagram) => diagram.querySelector('svg:not([aria-roledescription="error"]) g')),
        );
        await browserPage.evaluate(() => document.fonts.ready);
        // Playwright's CSS engine does not match the camel-case SVG tag, so query in the page.
        const labels = await browserPage.evaluate(() =>
          [...document.querySelectorAll('.vp-doc .mermaid foreignObject')].map((element) => {
            const box = element.getBoundingClientRect();
            const drawn = element.firstElementChild?.getBoundingClientRect() ?? box;
            return {
              text: element.textContent?.trim() ?? '',
              overflows: drawn.height > box.height + 0.5 || drawn.width > box.width + 0.5,
              visible: getComputedStyle(element).overflow === 'visible',
            };
          }),
        );
        expect(labels.length).toBeGreaterThan(0);
        const clipped = labels.filter((label) => label.overflows && !label.visible).map((label) => label.text);
        expect(clipped).toEqual([]);
      });
    }
  }
}
