import type { MockServer } from '../mock-server/server.ts';
import { serverPath } from './transport.ts';

/**
 * Pictures do not go through `fetch`: an `<img>` that names the sample-data server (an attachment
 * under `/api/` or the sample picture under `/__mock/`) would ask the static site, which has no such
 * file. The demo answers the picture from the page's server instead, as a `data:` URL, and leaves
 * the image empty when the server has no picture for it.
 */

const EMPTY_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/** The address an image should show instead of `src`, or null when `src` is not the server's. */
export function demoImageSource(server: MockServer, src: string, origin: string): string | null {
  const path = serverPath(src, origin);
  if (path === null) return null;
  const result = server.handle({ method: 'GET', url: path });
  if (result?.kind !== 'response' || result.status !== 200 || !result.body) return EMPTY_IMAGE;
  const type = result.headers['Content-Type'] ?? 'application/octet-stream';
  return `data:${type};charset=utf-8,${encodeURIComponent(result.body)}`;
}

/** Rewrites the server's pictures in `root` now and whenever the page adds or changes one. */
export function watchDemoImages(server: MockServer, root: Document): () => void {
  const origin = root.location?.origin ?? '';
  const rewrite = (image: HTMLImageElement) => {
    const src = image.getAttribute('src');
    if (!src) return;
    const next = demoImageSource(server, src, origin);
    if (next !== null) image.setAttribute('src', next);
  };
  const scan = (node: Node) => {
    if (node instanceof HTMLImageElement) rewrite(node);
    else if (node instanceof Element) node.querySelectorAll('img').forEach(rewrite);
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') scan(record.target);
      else record.addedNodes.forEach(scan);
    }
  });
  observer.observe(root.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  scan(root.documentElement);
  return () => observer.disconnect();
}
