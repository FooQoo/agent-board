// Whitespace and control characters (C0, space, DEL, C1). Browsers strip some of them from a URL
// before reading its scheme, so a value containing any of them is never accepted.
function hasForbiddenCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Returns `url` when it is an absolute http(s) URL with a host, otherwise null. */
function httpUrl(url: string): string | null {
  if (typeof url !== 'string' || url === '' || hasForbiddenCharacter(url)) return null;
  if (!/^https?:\/\/[^/?#\\]/i.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.hostname === '') return null;
  } catch {
    return null;
  }
  return url;
}

/** A link target that may be followed: `http` and `https` only. */
export function safeLinkUrl(url: string): string | null {
  return httpUrl(url);
}

/** An image source that may be fetched: external `http` and `https` only. */
export function safeImageUrl(url: string): string | null {
  return httpUrl(url);
}
