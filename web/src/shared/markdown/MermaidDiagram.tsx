import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbox } from '../ui/lightbox/Lightbox';
import {
  mermaidThemeFromCss,
  svgElementOf,
  watchPageTheme,
  renderMermaid,
  type MermaidTheme,
  type RenderResult,
} from './mermaid';
import './markdown.css';

/** The page theme for the diagrams; a new object only when a color of it changes. */
function useMermaidTheme(): MermaidTheme {
  const [theme, setTheme] = useState(() => mermaidThemeFromCss());
  useEffect(() => {
    const update = () => {
      const next = mermaidThemeFromCss();
      setTheme((current) => (current.id === next.id ? current : next));
    };
    const stop = watchPageTheme(update);
    update();
    return stop;
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

/** What the diagram area shows: the drawing is still running, it is drawn, or it was refused. */
export type MermaidViewState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'drawn'; svg: string };

/** The view state of a finished or unfinished drawing. `null` means the drawing has not finished. */
export function mermaidViewStateOf(result: RenderResult | null): MermaidViewState {
  if (result === null) return { status: 'loading' };
  if (!result.ok) return { status: 'failed', message: result.message };
  return { status: 'drawn', svg: result.svg };
}

/**
 * The presentation of one Mermaid block in each state. It takes the state as given, so every state can
 * be shown on its own. A wrong notation shows one line of the error and the source, so the text can still
 * be read and corrected. A drawn diagram opens enlarged on a press.
 */
export function MermaidDiagramView({ source, state }: { source: string; state: MermaidViewState }) {
  const { t } = useTranslation();
  const [enlarged, setEnlarged] = useState(false);

  if (state.status === 'loading') {
    return (
      <figure className="md-mermaid md-mermaid--loading" aria-busy="true">
        <p className="md-mermaid__status">{t('markdown.diagramLoading')}</p>
      </figure>
    );
  }

  if (state.status === 'failed') {
    return (
      <figure className="md-mermaid md-mermaid--error">
        <p className="md-mermaid__status" role="alert">
          {t('markdown.diagramError', { message: state.message })}
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
          <DrawnSvg className="md-mermaid__svg" svg={state.svg} />
        </button>
      </figure>
      {enlarged && (
        <Lightbox label={t('markdown.enlargeDiagram')} onClose={() => setEnlarged(false)}>
          <DrawnSvg className="lightbox__diagram" svg={state.svg} />
        </Lightbox>
      )}
    </>
  );
}

/** A Mermaid block drawn with the page's theme. The drawing runs once per source and theme. */
export function MermaidDiagram({ source }: { source: string }) {
  const theme = useMermaidTheme();
  const [drawn, setDrawn] = useState<{
    source: string;
    theme: MermaidTheme;
    result: RenderResult;
  } | null>(null);

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

  return <MermaidDiagramView source={source} state={mermaidViewStateOf(result)} />;
}
