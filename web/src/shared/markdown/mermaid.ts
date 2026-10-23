import { LruCache } from './model/lruCache';

/**
 * The one place that draws Mermaid diagrams. The library is loaded on the first use only, so the
 * first screen does not read it. Drawings are cached per source and theme, and run one at a time
 * because the library's configuration is global.
 */

/** The colors Mermaid takes from the page, and an id that changes whenever one of them does. */
export interface MermaidTheme {
  readonly id: string;
  readonly variables: Readonly<Record<string, string>>;
}

export type RenderResult = { ok: true; svg: string } | { ok: false; message: string };

/** Mermaid variable name, and the CSS variable of the page it takes its value from. */
const THEME_SOURCES: Readonly<Record<string, { css: string; fallback: string }>> = {
  background: { css: '--r-surface', fallback: '#ffffff' },
  mainBkg: { css: '--r-accent-soft', fallback: '#e9effd' },
  primaryColor: { css: '--r-accent-soft', fallback: '#e9effd' },
  primaryTextColor: { css: '--r-text', fallback: '#1b2430' },
  primaryBorderColor: { css: '--r-accent', fallback: '#2563eb' },
  nodeBorder: { css: '--r-accent', fallback: '#2563eb' },
  secondaryColor: { css: '--r-lane', fallback: '#eef0f4' },
  tertiaryColor: { css: '--r-bg', fallback: '#f6f7f9' },
  lineColor: { css: '--r-text2', fallback: '#566274' },
  textColor: { css: '--r-text', fallback: '#1b2430' },
  clusterBkg: { css: '--r-lane', fallback: '#eef0f4' },
  clusterBorder: { css: '--r-border', fallback: '#e1e5eb' },
  edgeLabelBackground: { css: '--r-surface', fallback: '#ffffff' },
};

/** The theme as the page shows it now. `root` is the element whose CSS variables are read. */
export function mermaidThemeFromCss(root: HTMLElement = document.documentElement): MermaidTheme {
  const style = getComputedStyle(root);
  const variables: Record<string, string> = {};
  for (const [name, source] of Object.entries(THEME_SOURCES)) {
    variables[name] = style.getPropertyValue(source.css).trim() || source.fallback;
  }
  return { id: JSON.stringify(variables), variables };
}

interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
}

let mermaidApi: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  mermaidApi ??= import('mermaid').then((module) => module.default as MermaidApi);
  // A failed load is retried on the next drawing instead of failing for the rest of the session.
  mermaidApi.catch(() => {
    mermaidApi = null;
  });
  return mermaidApi;
}

/** The first line of an error, which is the sentence shown to the reader. */
function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? ''
  );
}

/** The drawings kept for reuse: at most 50, and 2 MiB of SVG text in all; the least recently used go first. */
export const MERMAID_CACHE_MAX_ENTRIES = 50;
export const MERMAID_CACHE_MAX_BYTES = 2 * 1024 * 1024;
interface Kept {
  promise: Promise<RenderResult>;
  /** The outcome once the drawing has finished, so a remounted block can show it at once. */
  result: RenderResult | null;
}
const cache = new LruCache<Kept>({
  maxEntries: MERMAID_CACHE_MAX_ENTRIES,
  maxBytes: MERMAID_CACHE_MAX_BYTES,
});

/** The number and the size of the drawings kept now. */
export function mermaidCacheStats(): { entries: number; bytes: number } {
  return { entries: cache.size, bytes: cache.bytes };
}

/** Forgets every kept drawing. */
export function clearMermaidCache(): void {
  cache.clear();
}

const encoder = new TextEncoder();
function sizeOf(result: RenderResult): number {
  return encoder.encode(result.ok ? result.svg : result.message).length;
}
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;

/** A drawing that could not start (the library did not load) is not kept, so it is tried again. */
interface Drawing {
  result: RenderResult;
  transient: boolean;
}

async function draw(source: string, theme: MermaidTheme): Promise<Drawing> {
  sequence += 1;
  const id = `agb-mermaid-${sequence}`;
  let mermaid: MermaidApi;
  try {
    mermaid = await loadMermaid();
  } catch (error) {
    return { result: { ok: false, message: firstLine(error) }, transient: true };
  }
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // Labels are SVG text, not HTML inside `foreignObject`: a closed drawer kept every diagram
      // that had HTML labels, and the whole document around it, alive.
      htmlLabels: false,
      theme: 'base',
      themeVariables: { ...theme.variables },
    });
    const { svg } = await mermaid.render(id, source);
    return { result: { ok: true, svg }, transient: false };
  } catch (error) {
    // A failed drawing can leave its temporary element in the page.
    document.getElementById(`d${id}`)?.remove();
    return { result: { ok: false, message: firstLine(error) }, transient: false };
  }
}

const keyOf = (source: string, theme: MermaidTheme) => `${theme.id}\u0000${source}`;

/** The finished drawing of `source` with `theme` if it is kept, or null; it makes the drawing the most recent. */
export function cachedMermaid(source: string, theme: MermaidTheme): RenderResult | null {
  return cache.get(keyOf(source, theme))?.result ?? null;
}

/**
 * Draws `source` with `theme`. A wrong notation resolves to `{ ok: false }` with one line of the
 * error; it never rejects, so saving the text is never blocked by a diagram.
 */
export function renderMermaid(source: string, theme: MermaidTheme): Promise<RenderResult> {
  const key = keyOf(source, theme);
  const cached = cache.get(key);
  if (cached !== undefined) return cached.promise;

  const drawing = queue.then(() => draw(source, theme));
  queue = drawing;
  const kept: Kept = { result: null, promise: Promise.resolve({ ok: false, message: '' }) };
  kept.promise = drawing.then(({ result: outcome, transient }) => {
    if (transient) cache.delete(key);
    else if (cache.has(key)) {
      kept.result = outcome;
      // The size is known only now; a pending drawing is kept with no size.
      cache.set(key, kept, sizeOf(outcome));
    }
    return outcome;
  });
  cache.set(key, kept, 0);
  return kept.promise;
}

/**
 * The drawn SVG as DOM nodes. The text is parsed as SVG and never set as HTML; scripts and event
 * or `javascript:` attributes are dropped as well (the library already sanitizes its output).
 */
export function svgElementOf(svg: string): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length > 0)
    return null;
  for (const script of Array.from(root.querySelectorAll('script'))) script.remove();
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:')) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

/**
 * Calls `onChange` when the page's theme may have changed (its mode, accent or colors). The caller
 * compares the theme id before it redraws. Returns a function that stops watching.
 */
export function watchPageTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-mode', 'data-accent', 'class', 'style'],
  });
  return () => observer.disconnect();
}
