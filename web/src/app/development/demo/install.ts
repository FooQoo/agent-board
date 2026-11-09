import { fixture, longMarkdown } from 'virtual:agboard-demo-seed';
import { createMockServer } from '../mock-server/server.ts';
import { watchDemoImages } from './images.ts';
import { installDemoTransport } from './transport.ts';

/**
 * Starts the demo build's board in the page: a new sample-data server with the first-run guide at
 * its beginning, behind the page's `fetch`, `EventSource` and pictures. `app/entry/board.tsx` loads
 * this only when `import.meta.env.MODE` is `demo` (`vite build --mode demo`), so the product build
 * contains none of it. Nothing is saved: a reload starts again from the sample data.
 */
export function installDemo(): void {
  const server = createMockServer({ fixture, longMarkdown });
  installDemoTransport(server, window);
  watchDemoImages(server, document);
}
