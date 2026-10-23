/** One block of a document, as the detail stream delivers it. `source` is the block's text as sent. */
export interface MarkdownBlockData {
  /** Stable for the life of the block; the key of its row and of its memo. */
  id: string;
  kind: 'markdown' | 'mermaid';
  source: string;
  /** Picture sizes read from the files, looked up by the `src` written in the text. */
  images?: readonly MarkdownBlockImage[];
}

export interface MarkdownBlockImage {
  src: string;
  width?: number;
  height?: number;
}

/** A document of this many characters or blocks (or more) is virtualized; a smaller one is drawn whole. */
export const VIRTUALIZE_MAX_CHARS = 5000;
export const VIRTUALIZE_MAX_BLOCKS = 40;

export function shouldVirtualize(blocks: readonly MarkdownBlockData[]): boolean {
  if (blocks.length >= VIRTUALIZE_MAX_BLOCKS) return true;
  let total = 0;
  for (const block of blocks) {
    total += block.source.length;
    if (total >= VIRTUALIZE_MAX_CHARS) return true;
  }
  return false;
}

/** FNV-1a, in base 36. A fingerprint for memo keys, not a security hash. */
export function hashSource(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** The key of a block's row: it changes when the id or the text changes, so a changed block is redrawn. */
export function blockKey(block: MarkdownBlockData): string {
  return `${block.id}:${hashSource(block.source)}`;
}

const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*mermaid[^\n]*$/i;

/**
 * The diagram text of a `mermaid` block. The server sends such a block with its fence lines
 * (```` ```mermaid ... ``` ````); they are removed here. This applies to `mermaid` blocks only: a
 * `markdown` block is returned as it is, even when it contains a mermaid fence.
 */
export function mermaidSourceOfBlock(block: MarkdownBlockData): string {
  if (block.kind !== 'mermaid') return block.source;
  const lines = block.source.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const open = FENCE_OPEN.exec(lines[0] ?? '');
  if (open === null) return lines.join('\n');
  const fence = (open[1] as string)[0] as string;
  const length = (open[1] as string).length;
  const last = lines[lines.length - 1] ?? '';
  const closes =
    lines.length > 1 && new RegExp(`^[ \\t]{0,3}\\${fence}{${length},}[ \\t]*$`).test(last);
  return lines.slice(1, closes ? -1 : undefined).join('\n');
}

const LINE_HEIGHT = 24;
const CHARS_PER_LINE = 80;
const BLOCK_GAP = 12;
const DIAGRAM_HEIGHT = 240;
/** Used when a picture's size is unknown. */
const UNKNOWN_IMAGE_HEIGHT = 200;
const ASSUMED_WIDTH = 640;

/**
 * A first guess of a block's height in pixels, from its lines, its characters and the pictures it
 * names. The virtualizer replaces it with the measured height once the block is shown.
 */
export function estimateBlockSize(block: MarkdownBlockData): number {
  if (block.kind === 'mermaid') return DIAGRAM_HEIGHT + BLOCK_GAP;
  let rows = 0;
  for (const line of block.source.split('\n')) {
    rows += Math.max(1, Math.ceil(line.length / CHARS_PER_LINE));
  }
  let height = rows * LINE_HEIGHT + BLOCK_GAP;
  for (const image of block.images ?? []) {
    height +=
      image.width !== undefined && image.height !== undefined && image.width > 0
        ? Math.min(image.height, (image.height / image.width) * ASSUMED_WIDTH)
        : UNKNOWN_IMAGE_HEIGHT;
  }
  return Math.round(height);
}
