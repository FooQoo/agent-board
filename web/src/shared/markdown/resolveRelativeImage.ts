const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|\/)/i;

/**
 * Resolves an image `src` written in a document at `docPath` (relative to the Docs root) to a path
 * relative to the Docs root. Absolute URLs, `data:` URIs, root-absolute paths, and paths that climb
 * out of the root are returned unchanged.
 */
export function resolveRelativeImage(docPath: string, src: string): string {
  if (ABSOLUTE.test(src)) return src;
  const parts = docPath.split('/').slice(0, -1);
  for (const segment of src.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return src;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join('/');
}
