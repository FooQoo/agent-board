import type { EditorAttachment } from './attachmentTypes';

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * The name the server stores an image under: plain ASCII (letters, digits, dot, underscore, hyphen),
 * at most 100 characters, ending with the extension of its type. A name already used gets a number.
 */
export function storedImageName(
  attachment: Pick<EditorAttachment, 'name' | 'mediaType'>,
  taken: ReadonlySet<string>,
): string {
  const extension = EXTENSIONS[attachment.mediaType] ?? 'png';
  const base = attachment.name.split(/[\\/]/).pop() ?? '';
  const lower = base.toLowerCase();
  const hasExtension =
    lower.endsWith(`.${extension}`) || (extension === 'jpg' && lower.endsWith('.jpeg'));
  const stem = (hasExtension ? base.slice(0, base.lastIndexOf('.')) : base)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 80);
  const plain = stem === '' ? 'image' : stem;
  for (let n = 1; ; n += 1) {
    const candidate = `${plain}${n === 1 ? '' : `-${n}`}.${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
