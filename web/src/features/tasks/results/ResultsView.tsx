import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOffIcon, LinkIcon, Maximize2Icon } from 'lucide-react';
import { Lightbox } from '../../../shared/ui/lightbox/Lightbox';
import type { TaskResult } from '../../../shared/api/contracts';
import { formatShort } from '../model/format';
import type { TaskResultsState } from './useTaskResults';
import './results.css';

/**
 * The results tab: what an agent delivered for the task, newest first. Each one shows its kind,
 * time, summary, image (tap to enlarge), and link text. The link is shown as text because the
 * artifact may exist only on the PC. `focusVersion` is scrolled to and highlighted.
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
  const [zoom, setZoom] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
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
      <p className="results__summary">{result.summary}</p>
      {result.attachmentId !== undefined &&
        (imageFailed ? (
          <span className="results__missing">
            <ImageOffIcon aria-hidden="true" />
            {t('markdown.noImage')}
          </span>
        ) : (
          <button
            type="button"
            className="results__image"
            aria-label={t('results.enlarge', { version: result.version })}
            onClick={() => setZoom(true)}
          >
            <img
              src={attachmentUrl(result.attachmentId)}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
            <Maximize2Icon aria-hidden="true" />
          </button>
        ))}
      {result.link !== undefined && (
        <p className="results__link">
          <LinkIcon aria-hidden="true" />
          <span className="results__link-label">{t('results.link')}</span>
          <span className="results__link-text">{result.link}</span>
        </p>
      )}
      {zoom && result.attachmentId !== undefined && (
        <Lightbox
          label={t('results.enlarge', { version: result.version })}
          onClose={() => setZoom(false)}
        >
          <img src={attachmentUrl(result.attachmentId)} alt={result.summary} />
        </Lightbox>
      )}
    </li>
  );
}
