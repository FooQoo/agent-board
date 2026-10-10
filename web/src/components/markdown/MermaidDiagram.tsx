import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbox } from '../Lightbox';
import {
  mermaidThemeFromCss,
  renderMermaid,
  type MermaidTheme,
  type RenderResult,
} from '../../lib/mermaid';
import '../../styles/markdown.css';

/** The page theme for the diagrams; a new object only when a color of it changes. */
function useMermaidTheme(): MermaidTheme {
  const [theme, setTheme] = useState(() => mermaidThemeFromCss());
  useEffect(() => {
    const update = () => {
      const next = mermaidThemeFromCss();
      setTheme((current) => (current.id === next.id ? current : next));
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode', 'data-accent', 'class', 'style'],
    });
    update();
    return () => observer.disconnect();
  }, []);
  return theme;
}

/**
 * The drawn SVG as DOM nodes. The text is parsed as SVG and never set as HTML; scripts and event
 * or `javascript:` attributes are dropped as well (the library already sanitizes its output).
 */
function svgNodeOf(svg: string): SVGSVGElement | null {
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

/** A drawn diagram placed in a span as nodes; the span is the only element it adds. */
function DrawnSvg({ svg, className }: { svg: string; className: string }) {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const target = host.current;
    if (target === null) return;
    const node = svgNodeOf(svg);
    if (node === null) target.replaceChildren();
    else target.replaceChildren(node);
  }, [svg]);
  return <span ref={host} className={className} />;
}

/**
 * A Mermaid block drawn as a diagram. A wrong notation shows one line of the error and the source,
 * so the text can still be read and corrected. A drawn diagram opens enlarged on a press.
 */
export function MermaidDiagram({ source }: { source: string }) {
  const { t } = useTranslation();
  const theme = useMermaidTheme();
  const [drawn, setDrawn] = useState<{
    source: string;
    theme: MermaidTheme;
    result: RenderResult;
  } | null>(null);
  const [enlarged, setEnlarged] = useState(false);

  useEffect(() => {
    let current = true;
    void renderMermaid(source, theme).then((result) => {
      if (current) setDrawn({ source, theme, result });
    });
    return () => {
      current = false;
    };
  }, [source, theme]);

  const result =
    drawn !== null && drawn.source === source && drawn.theme === theme ? drawn.result : null;

  if (result === null) {
    return (
      <figure className="md-mermaid md-mermaid--loading" aria-busy="true">
        <p className="md-mermaid__status">{t('markdown.diagramLoading')}</p>
      </figure>
    );
  }

  if (!result.ok) {
    return (
      <figure className="md-mermaid md-mermaid--error">
        <p className="md-mermaid__status" role="alert">
          {t('markdown.diagramError', { message: result.message })}
        </p>
        <pre className="md-mermaid__source">
          <code>{source}</code>
        </pre>
      </figure>
    );
  }

  return (
    <>
      <figure className="md-mermaid">
        <button
          type="button"
          className="md-mermaid__open"
          aria-label={t('markdown.enlargeDiagram')}
          onClick={() => setEnlarged(true)}
        >
          <DrawnSvg className="md-mermaid__svg" svg={result.svg} />
        </button>
      </figure>
      {enlarged && (
        <Lightbox label={t('markdown.enlargeDiagram')} onClose={() => setEnlarged(false)}>
          <DrawnSvg className="lightbox__diagram" svg={result.svg} />
        </Lightbox>
      )}
    </>
  );
}
