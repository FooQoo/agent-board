import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ProjectResourceResult } from '../hooks/useProjectResource';
import '../styles/list-pane.css';

export interface ListPaneProps {
  title: string;
  /** The count next to the title, shown once the list is ready. */
  countText?: string;
  /** Shown under the heading while the list has rows. */
  description?: string;
  status: ProjectResourceResult<unknown>['status'];
  /** The last refresh failed, but the rows shown are from the last good read. */
  fetchFailed: boolean;
  onRetry: () => void;
  layoutRef?: (node: HTMLElement | null) => void;
  /** The list has no rows: the empty state's icon, title, and an optional hint. */
  empty: { icon: ReactNode; title: string; hint?: string };
  /** The rows are present. Their markup is the children. */
  hasRows: boolean;
  /** The accessible name of the row list. */
  listLabel: string;
  loadError: string;
  refreshError: string;
  className?: string;
  children?: ReactNode;
}

/**
 * The frame that the archive and the epic list share: heading, count, the
 * loading, load-failure, refresh-failure, and empty states, and the rows.
 * The list supplies its rows as children.
 */
export function ListPane({
  title,
  countText,
  description,
  status,
  fetchFailed,
  onRetry,
  layoutRef,
  empty,
  hasRows,
  listLabel,
  loadError,
  refreshError,
  className,
  children,
}: ListPaneProps) {
  const { t } = useTranslation();

  return (
    <main className={className ? `list-pane ${className}` : 'list-pane'} ref={layoutRef}>
      <header className="list-pane__header">
        <div className="list-pane__heading">
          <h2>{title}</h2>
          {status === 'ready' && countText && <span className="list-pane__count">{countText}</span>}
        </div>
        {hasRows && description && <p>{description}</p>}
      </header>

      {status === 'loading' && (
        <div className="list-pane__state" role="status">
          {t('board.loading')}
        </div>
      )}

      {status === 'error' && (
        <div className="list-pane__state" role="alert">
          <p>{loadError}</p>
          <Button type="button" variant="outline" onClick={onRetry}>
            {t('board.retry')}
          </Button>
        </div>
      )}

      {status === 'ready' && fetchFailed && (
        <p className="list-pane__error" role="alert">
          {refreshError}{' '}
          <Button type="button" variant="ghost" onClick={onRetry}>
            {t('board.retry')}
          </Button>
        </p>
      )}

      {status === 'ready' && !hasRows && (
        <div className="list-pane__empty">
          {empty.icon}
          <p>{empty.title}</p>
          {empty.hint && <p>{empty.hint}</p>}
        </div>
      )}

      {status === 'ready' && hasRows && (
        <div className="list-pane__rows" role="list" aria-label={listLabel}>
          {children}
        </div>
      )}
    </main>
  );
}
