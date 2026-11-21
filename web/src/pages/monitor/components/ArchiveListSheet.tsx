import { ArchiveIcon } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ArchiveResponse } from '../../../features/tasks/api/read';
import { Button } from '@/shared/ui/button';
import { Surface } from '../../../shared/ui/surface/Surface';
import { ArchiveListFooter } from '../../../features/tasks/archive/ArchiveListFooter';
import { ArchiveVirtualList } from './ArchiveVirtualList';
import './archive-sheet.css';
import { Spinner } from '@/shared/ui/spinner/Spinner';

const noop = () => {};

/** What the sheet shows of the archive: the read the phone made when the sheet opened. */
export interface ArchiveSheetData {
  data: ArchiveResponse | null;
  status: 'loading' | 'ready' | 'error';
  fetchFailed?: boolean;
  onRetry?: () => void;
  /** The next page: more follow, one is on its way, the last request failed, and how to ask. Absent when the list is whole. */
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreFailed?: boolean;
  loadMore?: () => void;
  retryMore?: () => void;
}

export interface ArchiveListSheetProps extends ArchiveSheetData {
  /** Restores one task to the lane it was archived from; rejects when it could not. */
  onRestore: (taskId: number) => Promise<void>;
  onClose: () => void;
  /** The project's name, which the cards show. */
  projectName: string;
  /** A story's still picture: the row whose Restore tile starts open. */
  initialRevealed?: number | null;
}

/**
 * The phone's archive list: a bottom drawer with the archived tasks, newest first, read a page at a time as the list scrolls. Each row is the
 * card the lanes use. A left swipe on a row uncovers Restore at once, and pressing it returns the
 * task to the lane and run state it was archived with. A tap outside the open row closes it.
 */
export function ArchiveListSheet({
  data,
  status,
  fetchFailed = false,
  onRetry,
  hasMore = false,
  loadingMore = false,
  loadMoreFailed = false,
  loadMore,
  retryMore,
  onRestore,
  onClose,
  projectName,
  initialRevealed = null,
}: ArchiveListSheetProps) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState<number | null>(initialRevealed);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState(false);
  // The sheet's scrolling body, which the virtual list reads its window from.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const busyRef = useRef<number | null>(null);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const tasks = data?.tasks ?? [];

  useEffect(() => {
    if (revealed === null) return;
    const release = (event: PointerEvent) => {
      if (!(event.target as Element).closest(`[data-archive-row="${revealed}"]`)) setRevealed(null);
    };
    document.addEventListener('pointerdown', release, true);
    return () => document.removeEventListener('pointerdown', release, true);
  }, [revealed]);

  // Stable, so a change to one row does not re-render the others.
  const restore = useCallback(async (id: number) => {
    if (busyRef.current !== null) return;
    busyRef.current = id;
    setBusy(id);
    setError(false);
    try {
      await onRestoreRef.current(id);
      setRevealed(null);
    } catch {
      setError(true);
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }, []);
  const onRestoreRow = useCallback((id: number) => void restore(id), [restore]);
  const onRevealChange = useCallback(
    (id: number, next: boolean) =>
      setRevealed((current) => (next ? id : current === id ? null : current)),
    [],
  );

  let body: ReactNode;
  if (status === 'loading') {
    body = (
      <div className="archive-sheet__note">
        <Spinner size="lg" label={t('archive.loading')} />
      </div>
    );
  } else if (status === 'error' || data === null) {
    body = (
      <div className="archive-sheet__note" role="alert">
        <p>{t('archive.loadError')}</p>
        {onRetry && (
          <Button type="button" variant="outline" onClick={onRetry}>
            {t('archive.retry')}
          </Button>
        )}
      </div>
    );
  } else if (tasks.length === 0) {
    body = (
      <div className="archive-sheet__empty">
        <ArchiveIcon aria-hidden="true" />
        <p>{t('archive.empty')}</p>
        <p className="archive-sheet__hint">{t('archive.emptyHint')}</p>
      </div>
    );
  } else {
    body = (
      <>
        <p className="archive-sheet__hint">{t('archive.listHint')}</p>
        {(error || fetchFailed) && (
          <p className="archive-sheet__error" role="alert">
            {error ? t('archive.restoreError') : t('archive.refreshError')}
          </p>
        )}
        <ArchiveVirtualList
          tasks={tasks}
          projectId={data.project.id}
          projectName={projectName}
          label={t('archive.heading')}
          scrollElement={scroller}
          revealed={revealed}
          busy={busy}
          onRevealChange={onRevealChange}
          onRestore={onRestoreRow}
          pages={{ hasMore, loadingMore, loadMoreFailed, loadMore: loadMore ?? noop }}
        />
        <ArchiveListFooter
          className="archive-sheet__footer"
          hasMore={hasMore}
          loadingMore={loadingMore}
          loadMoreFailed={loadMoreFailed}
          onRetry={retryMore ?? noop}
        />
      </>
    );
  }
  return (
    <Surface
      kind="sheet"
      title={t('archive.listTitle')}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      className="archive-sheet"
      bodyRef={setScroller}
    >
      {body}
    </Surface>
  );
}
