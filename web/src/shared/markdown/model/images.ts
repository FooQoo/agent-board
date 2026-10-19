import { safeImageUrl } from './urls';

/** Turns an owned attachment id into the URL to show; null when it is not one of the card's. */
export type AttachmentResolver = (id: string) => string | null;

const ATTACHMENT_SOURCE = /^attachment:([0-9a-f]{32})$/;
const ASSET_SOURCE = /^assets\/([0-9a-f]{32})\.(?:png|jpe?g|webp|gif)$/;

/**
 * The URL an image source shows, or null for No image. An owned reference (`attachment:<id>` or
 * `assets/<id>.<ext>`) goes through the resolver only; any other relative or malformed reference
 * is never fetched; external http(s) images pass the allow-list.
 */
export function imageUrlOf(
  src: string | undefined,
  resolve: AttachmentResolver | undefined,
): string | null {
  if (src === undefined) return null;
  const id = ATTACHMENT_SOURCE.exec(src)?.[1] ?? ASSET_SOURCE.exec(src)?.[1];
  if (id !== undefined) return resolve?.(id) ?? null;
  if (src.startsWith('attachment:') || src.startsWith('assets/')) return null;
  return safeImageUrl(src);
}
