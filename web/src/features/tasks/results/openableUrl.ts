/**
 * The address a result link can be opened at, or null. Only an absolute `http:` or `https:` URL
 * qualifies; anything else (a local path, `file:`, `javascript:`, `data:`, text) stays plain text,
 * because the artifact may exist only on the PC. This is not the board's own result deep link,
 * which `resultLink.ts` builds.
 */
export function openableUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
}
