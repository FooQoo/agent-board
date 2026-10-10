import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbox } from '../Lightbox';
import {
  mermaidThemeFromCss,
  svgElementOf,
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

/** A drawn diagram placed in a span as nodes; the span is the only element it adds. */
function DrawnSvg({ svg, className }: { svg: string; className: string }) {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const target = host.current;
    if (target === null) return;
    const node = svgElementOf(svg);
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
