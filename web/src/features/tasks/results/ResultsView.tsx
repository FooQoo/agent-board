import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOffIcon, LinkIcon, Maximize2Icon } from 'lucide-react';
import { Lightbox } from '../../../shared/ui/lightbox/Lightbox';
import { resultImageIds, type TaskResult } from '../../../shared/api/contracts';
import { openableUrl } from './openableUrl';
import { formatShort } from '../model/format';
import type { TaskResultsState } from './useTaskResults';
import './results.css';

/**
 * The results tab: what an agent delivered for the task, newest first. Each one shows its kind,
 * time, title, summary, image (tap to enlarge), and link. The link is text, because the artifact may exist
 * only on the PC, unless it is an http(s) URL, which opens in a new tab. `focusVersion` is scrolled to and highlighted.
 */
export function ResultsView({
  state,
  attachmentUrl,
  focusVersion,
  refreshFailed = false,
  onRetry,
}: {
  state: TaskResultsState;
  attachmentUrl: (attachmentId: string) => string;
  focusVersion?: number | null;
  /** The latest read failed; the results shown are the ones read before. */
  refreshFailed?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLOListElement>(null);
  const openedAt = useRef(Date.now());
  // Pictures above the linked result change the layout as they load: for a moment after the view
  // opens, the linked result is scrolled to again, so it still is where the person looks.
  const settleFocus = () => {
    if (Date.now() - openedAt.current > 3000) return;
    listRef.current?.querySelector('[data-focused="true"]')?.scrollIntoView?.({ block: 'start' });
  };
  if (state.status === 'loading') return <p className="results__note">{t('results.loading')}</p>;
  if (state.status === 'error')
    return (
      <div className="results__note" role="alert">
        <p>{t('results.failed')}</p>
        {onRetry && (
          <button type="button" className="results__retry" onClick={onRetry}>
            {t('results.retry')}
          </button>
        )}
      </div>
    );
  const newestFirst = [...state.results].sort((a, b) => b.version - a.version);
  const missing =
    focusVersion != null && !state.results.some((result) => result.version === focusVersion);
  return (
    <div className="results">
      {refreshFailed && (
        <div className="results__note" role="alert">
          <p>{t('results.refreshFailed')}</p>
          {onRetry && (
            <button type="button" className="results__retry" onClick={onRetry}>
              {t('results.retry')}
            </button>
          )}
        </div>
      )}
      {missing && (
        <p className="results__note" role="status">
          {t('results.versionMissing', { version: focusVersion })}
        </p>
      )}
      {state.results.length === 0 && <p className="results__note">{t('results.empty')}</p>}
      <ol className="results__list" ref={listRef} onLoadCapture={settleFocus}>
        {newestFirst.map((result) => (
          <ResultItem
            key={result.version}
            result={result}
            attachmentUrl={attachmentUrl}
            focused={result.version === focusVersion}
          />
        ))}
      </ol>
    </div>
  );
}

function ResultItem({
  result,
  attachmentUrl,
  focused,
}: {
  result: TaskResult;
  attachmentUrl: (attachmentId: string) => string;
  focused: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'start' });
  }, [focused]);
  const kind = t(`results.kind.${result.kind}`);
  return (
    <li
      ref={ref}
      className="results__item"
      data-result-version={result.version}
      data-focused={focused ? 'true' : undefined}
      aria-current={focused ? 'true' : undefined}
    >
      <div className="results__head">
        <span className="results__kind" data-kind={result.kind}>
          {kind}
        </span>
        <span className="results__version">
          {t('results.version', { version: result.version })}
        </span>
        <time className="results__at" dateTime={result.at}>
          {formatShort(result.at)}
        </time>
      </div>
      <h3 className="results__title">{result.title}</h3>
      <p className="results__summary">{result.summary}</p>
      <ResultImages result={result} attachmentUrl={attachmentUrl} />
      {result.link !== undefined && (
        <p className="results__link">
          <LinkIcon aria-hidden="true" />
          <span className="results__link-label">{t('results.link')}</span>
          <ResultLinkText link={result.link} />
        </p>
      )}
    </li>
  );
}

/**
 * The images of one result. One image is shown large; several are a strip of thumbnails that
 * scrolls sideways. Tapping any of them opens the enlarged view at that image, where the person can
 * swipe to the others.
 */
function ResultImages({
  result,
  attachmentUrl,
}: {
  result: TaskResult;
  attachmentUrl: (attachmentId: string) => string;
}) {
  const { t } = useTranslation();
  const ids = resultImageIds(result);
  const [zoom, setZoom] = useState<number | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  if (ids.length === 0) return null;
  const many = ids.length > 1;
  const markFailed = (id: string) => setFailed((previous) => new Set(previous).add(id));
  const label = (index: number) =>
    many
      ? t('results.enlargeNth', {
          version: result.version,
          index: index + 1,
          count: ids.length,
        })
      : t('results.enlarge', { version: result.version });
  return (
    <>
      <div className={many ? 'results__strip' : undefined} data-image-count={ids.length}>
        {ids.map((id, index) =>
          failed.has(id) ? (
            <span key={id} className="results__missing">
              <ImageOffIcon aria-hidden="true" />
              {t('markdown.noImage')}
            </span>
          ) : (
            <button
              key={id}
              type="button"
              className="results__image"
              aria-label={label(index)}
              onClick={() => setZoom(index)}
            >
              <img src={attachmentUrl(id)} alt="" loading="lazy" onError={() => markFailed(id)} />
              <Maximize2Icon aria-hidden="true" />
            </button>
          ),
        )}
      </div>
      {zoom !== null && (
        <Lightbox label={label(zoom)} onClose={() => setZoom(null)}>
          <ImageViewer
            urls={ids.map(attachmentUrl)}
            alt={result.summary}
            index={zoom}
            onIndexChange={setZoom}
          />
        </Lightbox>
      )}
    </>
  );
}

/**
 * The enlarged images of one result: a row of full-width slides that snaps to one slide at a time.
 * The browser's own scrolling does the work: a sideways swipe moves between slides, and each slide
 * scrolls up and down by itself when its image is taller than the viewer, so the two gestures
 * never compete. The left and right arrow keys step too.
 */
function ImageViewer({
  urls,
  alt,
  index,
  onIndexChange,
}: {
  urls: string[];
  alt: string;
  index: number;
  onIndexChange: (index: number) => void;
}) {
  const { t } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const count = urls.length;
  const scrollToIndex = useCallback((target: number, smooth: boolean) => {
    const element = track.current;
    if (!element || typeof element.scrollTo !== 'function') return;
    element.scrollTo({
      left: target * element.clientWidth,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);
  // Open at the tapped image, before the first paint.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the first position is applied here
  useLayoutEffect(() => {
    scrollToIndex(index, false);
    // Only the first position is applied here; later moves come from the person's own scrolling.
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = Math.min(
        count - 1,
        Math.max(0, index + (event.key === 'ArrowRight' ? 1 : -1)),
      );
      if (target === index) return;
      event.preventDefault();
      onIndexChange(target);
      scrollToIndex(target, true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [count, index, onIndexChange, scrollToIndex]);
  const onScroll = () => {
    const element = track.current;
    if (!element || element.clientWidth === 0) return;
    const current = Math.round(element.scrollLeft / element.clientWidth);
    if (current !== index && current >= 0 && current < count) onIndexChange(current);
  };
  return (
    <div className="results__zoom">
      <div className="results__viewer" ref={track} onScroll={onScroll} data-viewer>
        {urls.map((url, slide) => (
          <div
            key={url}
            className="results__slide"
            role="group"
            aria-roledescription="slide"
            aria-label={t('results.imagePosition', { index: slide + 1, count })}
          >
            <img
              src={url}
              alt={alt}
              loading={Math.abs(slide - index) <= 1 ? 'eager' : 'lazy'}
              draggable={false}
            />
          </div>
        ))}
      </div>
      {count > 1 && (
        <span className="results__position" aria-live="polite">
          {t('results.imagePosition', { index: index + 1, count })}
        </span>
      )}
    </div>
  );
}

function ResultLinkText({ link }: { link: string }) {
  const href = openableUrl(link);
  if (href === null) return <span className="results__link-text">{link}</span>;
  return (
    <a
      className="results__link-text results__link-anchor"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {link}
    </a>
  );
}
