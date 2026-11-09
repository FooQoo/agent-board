import { fixture, longMarkdown } from 'virtual:agboard-demo-seed';
import { applyLocale } from '../../../shared/i18n';
import { createMockServer } from '../mock-server/server.ts';
import { watchDemoImages } from './images.ts';
import { browserLanguages, demoLocale } from './locale.ts';
import { installDemoTransport } from './transport.ts';

/**
 * Starts the demo build's board in the page: a new sample-data server with the first-run guide at
 * its beginning, behind the page's `fetch`, `EventSource` and pictures. `app/entry/board.tsx` loads
 * this only when `import.meta.env.MODE` is `demo` (`vite build --mode demo`), so the product build
 * contains none of it. Nothing is saved: a reload starts again from the sample data.
 *
 * The screens, the guide and the sample data start in the browser's language (`demoLocale`)
 * before the first screen is drawn, in place of any language an earlier visit left in the browser.
 */
export function installDemo(): void {
  const locale = demoLocale(browserLanguages(navigator));
  applyLocale(locale);
  const server = createMockServer({ fixture, longMarkdown, locale });
  installDemoTransport(server, window);
  watchDemoImages(server, document);
}
