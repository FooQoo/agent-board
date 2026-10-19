import {
  mermaidThemeFromCss,
  renderMermaid,
  svgElementOf,
  watchPageTheme,
  type MermaidTheme,
  type RenderResult,
} from '../markdown/mermaid';

/** The sentence shown for a diagram that cannot be drawn; the editor passes its own translation. */
export type DiagramErrorText = (message: string) => string;

function errorBlock(message: string, errorText: DiagramErrorText): HTMLElement {
  const box = document.createElement('div');
  box.className = 'rich-mermaid rich-mermaid--error';
  box.setAttribute('role', 'alert');
  box.textContent = errorText(message);
  return box;
}

/** The drawing of a Mermaid block as an element: the diagram, or one line of the error. */
function previewElement(result: RenderResult, errorText: DiagramErrorText): HTMLElement {
  if (!result.ok) return errorBlock(result.message, errorText);
  const svg = svgElementOf(result.svg);
  if (svg === null) return errorBlock('', errorText);
  const box = document.createElement('div');
  box.className = 'rich-mermaid';
  box.append(svg);
  return box;
}

interface PreviewEntry {
  content: string;
  apply: (value: HTMLElement) => void;
  element: HTMLElement | null;
  /** The element has been in the page; one that was and is gone belongs to a block that is gone. */
  attached: boolean;
}

/**
 * The Mermaid previews of one editor. A preview is drawn when its block is shown or changed, and
 * drawn again when the page theme changes. The draw is cached per source and theme, so only a
 * real change of colors draws again. A preview whose element left the page is no longer kept.
 */
export class MermaidPreviews {
  private readonly entries = new Set<PreviewEntry>();
  private theme: MermaidTheme = mermaidThemeFromCss();
  private readonly stopWatching: () => void;
  private readonly errorText: DiagramErrorText;

  constructor(errorText: DiagramErrorText) {
    this.errorText = errorText;
    this.stopWatching = watchPageTheme(() => this.redrawIfThemeChanged());
  }

  /** The `renderPreview` of the code block; the element arrives through `apply`, so this returns null. */
  render(language: string, content: string, apply: (value: HTMLElement) => void): null {
    if (language !== 'mermaid') return null;
    const entry: PreviewEntry = { content, apply, element: null, attached: false };
    this.entries.add(entry);
    this.draw(entry);
    return null;
  }

  dispose(): void {
    this.stopWatching();
    this.entries.clear();
  }

  private draw(entry: PreviewEntry): void {
    const theme = this.theme;
    void renderMermaid(entry.content, theme).then((result) => {
      // A drawing in older colors, or for a block that is gone, is not shown.
      if (!this.entries.has(entry) || theme !== this.theme) return;
      const element = previewElement(result, this.errorText);
      entry.element = element;
      entry.apply(element);
    });
  }

  private redrawIfThemeChanged(): void {
    const next = mermaidThemeFromCss();
    if (next.id === this.theme.id) return;
    this.theme = next;
    for (const entry of this.entries) {
      if (entry.element?.isConnected) entry.attached = true;
      if (entry.attached && entry.element !== null && !entry.element.isConnected) {
        this.entries.delete(entry);
      }
    }
    for (const entry of this.entries) this.draw(entry);
  }
}
