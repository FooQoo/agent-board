import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toolName } from '../state';
import type { LogState } from '../useSessionLog';
import type { SessionTool } from '../api';

/** How far from the end still counts as "at the end" (a fraction of a line is not scrolling away). */
const AT_END_PX = 24;

/**
 * The right pane: the tail of the log of the tool. It follows the end while the reader is at the
 * end, and stays where it is once the reader has scrolled up to read.
 */
export function ResidentLogPane({ tool, log }: { tool: SessionTool; log: LogState }) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const text = log.data?.text ?? '';

  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && atEnd.current) node.scrollTop = node.scrollHeight;
  });

  const onScroll = () => {
    const node = scroller.current;
    if (node) atEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight <= AT_END_PX;
  };

  return (
    <section className="resident-log" aria-label={t('resident.logTitle')}>
      <h3 className="resident-log__title">
        {t('resident.logTitle')}
        <span className="resident-log__tool">{toolName(tool)}</span>
      </h3>
      {log.data?.truncated && <p className="resident-log__note">{t('resident.logTruncated')}</p>}
      {text === '' ? (
        <p className="resident-log__empty" role="status">
          {log.data ? t('resident.logEmpty') : t('status.boardLoading')}
        </p>
      ) : (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a keyboard user must be able to scroll the log
        <div className="resident-log__scroll" ref={scroller} onScroll={onScroll} tabIndex={0}>
          <pre className="resident-log__text">{text}</pre>
        </div>
      )}
      {log.failed && (
        <p className="resident-log__error" role="status">
          {t('resident.logFailed')}
        </p>
      )}
    </section>
  );
}
