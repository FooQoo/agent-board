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

const CACHE_LIMIT = 200;
const cache = new Map<string, Promise<RenderResult>>();
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

/**
 * Draws `source` with `theme`. A wrong notation resolves to `{ ok: false }` with one line of the
 * error; it never rejects, so saving the text is never blocked by a diagram.
 */
export function renderMermaid(source: string, theme: MermaidTheme): Promise<RenderResult> {
  const key = `${theme.id}\u0000${source}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const drawing = queue.then(() => draw(source, theme));
  queue = drawing;
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const result = drawing.then(({ result: outcome, transient }) => {
    if (transient) cache.delete(key);
    return outcome;
  });
  cache.set(key, result);
  return result;
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
