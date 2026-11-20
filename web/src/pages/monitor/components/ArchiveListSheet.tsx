import { ArchiveIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ArchiveResponse } from '../../../features/tasks/api/read';
import { Button } from '@/shared/ui/button';
import { Surface } from '../../../shared/ui/surface/Surface';
import { ArchiveSwipeRow } from './ArchiveSwipeRow';
import './archive-sheet.css';

/** What the sheet shows of the archive: the read the phone made when the sheet opened. */
export interface ArchiveSheetData {
  data: ArchiveResponse | null;
  status: 'loading' | 'ready' | 'error';
  fetchFailed?: boolean;
  onRetry?: () => void;
}

export interface ArchiveListSheetProps extends ArchiveSheetData {
  /** Restores one task to the lane it was archived from; rejects when it could not. */
  onRestore: (taskId: number) => Promise<void>;
  onClose: () => void;
  /** A story's still picture: the row that starts chosen, and whether its tile is open. */
  initialArmed?: number | null;
  initialRevealed?: boolean;
}

/**
 * The phone's archive list: a bottom drawer with every archived task, newest first. A tap chooses a
 * row, a right swipe uncovers Restore, and pressing it returns the task to the lane and run state it
 * was archived with. A tap outside the chosen row lets it go.
 */
export function ArchiveListSheet({
  data,
  status,
  fetchFailed = false,
  onRetry,
  onRestore,
  onClose,
  initialArmed = null,
  initialRevealed = false,
}: ArchiveListSheetProps) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState<number | null>(initialArmed);
  const [revealed, setRevealed] = useState(initialArmed !== null && initialRevealed);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const tasks = data?.tasks ?? [];

  useEffect(() => {
    if (armed === null) return;
    const release = (event: PointerEvent) => {
      if (!(event.target as Element).closest(`[data-archive-row="${armed}"]`)) {
        setArmed(null);
        setRevealed(false);
      }
    };
    document.addEventListener('pointerdown', release, true);
    return () => document.removeEventListener('pointerdown', release, true);
  }, [armed]);

  const restore = async (id: number) => {
    if (busy !== null) return;
    setBusy(id);
    setError(false);
    try {
      await onRestore(id);
      setArmed(null);
      setRevealed(false);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  let body: ReactNode;
  if (status === 'loading') {
    body = <p className="archive-sheet__note">{t('archive.loading')}</p>;
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
        <div className="archive-sheet__list" role="list" aria-label={t('archive.heading')}>
          {tasks.map((task) => (
            <ArchiveSwipeRow
              key={task.id}
              task={task}
              armed={armed === task.id}
              revealed={armed === task.id && revealed}
              busy={busy === task.id}
              onArm={() => {
                if (armed !== task.id) {
                  setArmed(task.id);
                  setRevealed(false);
                }
              }}
              onRevealChange={(next) => {
                setArmed(task.id);
                setRevealed(next);
              }}
              onRestore={() => void restore(task.id)}
            />
          ))}
        </div>
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
    >
      {body}
    </Surface>
  );
}
