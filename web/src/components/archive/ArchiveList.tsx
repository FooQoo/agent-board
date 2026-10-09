import { ArchiveIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ArchiveResponse } from '../../api';
import type { ProjectResourceResult } from '../../hooks/useProjectResource';
import type { Card } from '../../types';
import { AssigneeLabel } from '../AssigneeLabel';
import '../../styles/archive.css';

export interface ArchiveListProps {
  data: ArchiveResponse | null;
  status: ProjectResourceResult<ArchiveResponse>['status'];
  fetchFailed: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onRetry: () => void;
  actionError?: boolean;
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
  actionError = false,
  layoutRef,
}: ArchiveListProps) {
  const { t } = useTranslation();
  const cards: Card[] = data?.cards ?? [];

  return (
    <main className="archive-list-pane" ref={layoutRef}>
      <header className="archive-list-pane__header">
        <div className="archive-list-pane__heading">
          <h2>{t('archive.title')}</h2>
          {status === 'ready' && (
            <span className="archive-list-pane__count">
              {t('archive.count', { count: cards.length })}
            </span>
          )}
        </div>
        {cards.length > 0 && <p>{t('archive.description')}</p>}
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

      {status === 'ready' && actionError && (
        <p className="archive-list-pane__error" role="alert">
          {t('archive.error')}
        </p>
      )}

      {status === 'ready' && cards.length === 0 && (
        <div className="archive-list-pane__empty">
          <ArchiveIcon aria-hidden="true" />
          <p>{t('archive.empty')}</p>
          <p>{t('archive.emptyHint')}</p>
        </div>
      )}

      {status === 'ready' && cards.length > 0 && (
        <div className="archive-list" role="list" aria-label={t('archive.heading')}>
          {cards.map((card) => (
            <div className="archive-row" role="listitem" key={card.id}>
              <button
                type="button"
                aria-pressed={selectedId === card.id}
                onClick={() => onSelect(selectedId === card.id ? null : card.id)}
              >
                <span className="archive-row__id">#{card.id}</span>
                <span className="archive-row__title" title={card.title}>
                  {card.title}
                </span>
                <AssigneeLabel assignee={card.assignee} />
                <time
                  className="archive-row__date"
                  dateTime={card.archivedAt ?? undefined}
                  title={card.archivedAt ?? undefined}
                >
                  {card.archivedAt?.slice(0, 10) ?? '—'}
                </time>
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
