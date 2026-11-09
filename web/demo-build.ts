import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Where GitHub Pages serves the demo; `AGBOARD_DEMO_BASE` serves it from another path. */
export const DEMO_BASE = process.env.AGBOARD_DEMO_BASE ?? '/agent-board/demo/';
export const DEMO_OUT_DIR = 'dist-demo';

const SEED_ID = 'virtual:agboard-demo-seed';
const RESOLVED_SEED_ID = `\0${SEED_ID}`;
const FIXTURE_PATH = resolve(import.meta.dirname, 'test/fixtures/board.json');
const LONG_MARKDOWN_PATH = resolve(import.meta.dirname, 'test/fixtures/long-markdown.md');

/**
 * The demo build (`vite build --mode demo`): the board runs in the browser on the sample data, with
 * no server behind it. This plugin gives the page the sample data as `virtual:agboard-demo-seed`
 * and fills the page's server placeholders: a token the sample-data server accepts, and no build
 * ID, so the page never reloads for a newer build. Only registered in the `demo` mode.
 */
export function demoBuild(): Plugin {
  return {
    name: 'agboard-demo-build',
    resolveId: (id) => (id === SEED_ID ? RESOLVED_SEED_ID : null),
    load(id) {
      if (id !== RESOLVED_SEED_ID) return null;
      const fixture = readFileSync(FIXTURE_PATH, 'utf8');
      const longMarkdown = readFileSync(LONG_MARKDOWN_PATH, 'utf8');
      return `export const fixture = ${fixture};\nexport const longMarkdown = ${JSON.stringify(longMarkdown)};\n`;
    },
    transformIndexHtml: (html) =>
      html.replace('{{AGBOARD_TOKEN}}', 'demo-token').replace('{{AGBOARD_BUILD_ID}}', ''),
  };
}
