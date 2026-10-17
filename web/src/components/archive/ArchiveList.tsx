import { ArchiveIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ArchiveResponse } from '../../api';
import type { ProjectResourceResult } from '../../hooks/useProjectResource';
import type { Task } from '../../types';
import { AssigneeLabel } from '../AssigneeLabel';
import { EpicBadge } from '../EpicBadge';
import '../../styles/archive.css';

export interface ArchiveListProps {
  data: ArchiveResponse | null;
  status: ProjectResourceResult<ArchiveResponse>['status'];
  fetchFailed: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onRetry: () => void;
  layoutRef?: (node: HTMLElement | null) => void;
}

/** The archive list is a display slot in App's shared list/detail layout. */
export function ArchiveList({
  data,
  status,
  fetchFailed,
  selectedId,
  onSelect,
  onRetry,
  layoutRef,
}: ArchiveListProps) {
  const { t } = useTranslation();
  const tasks: Task[] = data?.tasks ?? [];

  return (
    <main className="archive-list-pane" ref={layoutRef}>
      <header className="archive-list-pane__header">
        <div className="archive-list-pane__heading">
          <h2>{t('archive.title')}</h2>
          {status === 'ready' && (
            <span className="archive-list-pane__count">
              {t('archive.count', { count: tasks.length })}
            </span>
          )}
        </div>
        {tasks.length > 0 && <p>{t('archive.description')}</p>}
      </header>

      {status === 'loading' && (
        <div className="archive-list-pane__state" role="status">
          {t('board.loading')}
        </div>
      )}

      {status === 'error' && (
        <div className="archive-list-pane__state" role="alert">
          <p>{t('archive.loadError')}</p>
          <Button type="button" variant="outline" onClick={onRetry}>
            {t('board.retry')}
          </Button>
        </div>
      )}

      {status === 'ready' && fetchFailed && (
        <p className="archive-list-pane__error" role="alert">
          {t('archive.refreshError')}{' '}
          <Button type="button" variant="ghost" onClick={onRetry}>
            {t('board.retry')}
          </Button>
        </p>
      )}

      {status === 'ready' && tasks.length === 0 && (
        <div className="archive-list-pane__empty">
          <ArchiveIcon aria-hidden="true" />
          <p>{t('archive.empty')}</p>
          <p>{t('archive.emptyHint')}</p>
        </div>
      )}

      {status === 'ready' && tasks.length > 0 && (
        <div className="archive-list" role="list" aria-label={t('archive.heading')}>
          {tasks.map((task) => (
            <div className="archive-row" role="listitem" key={task.id}>
              <button
                type="button"
                aria-pressed={selectedId === task.id}
                onClick={() => onSelect(selectedId === task.id ? null : task.id)}
              >
                <span className="archive-row__id">#{task.id}</span>
                <span className="archive-row__title" title={task.title}>
                  {task.title}
                </span>
                <AssigneeLabel assignee={task.assignee} />
                <span className="archive-row__meta">
                  <time
                    className="archive-row__date"
                    dateTime={task.archivedAt ?? undefined}
                    title={task.archivedAt ?? undefined}
                  >
                    {task.archivedAt?.slice(0, 10) ?? '—'}
                  </time>
                  {task.epic && <EpicBadge epic={task.epic} className="archive-row__epic" />}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
