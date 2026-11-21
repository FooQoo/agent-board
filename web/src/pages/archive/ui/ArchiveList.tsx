import { ArchiveIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ArchivePages } from '../../../features/tasks/model/useArchivePages';
import { ArchiveListFooter } from '../../../features/tasks/archive/ArchiveListFooter';
import { ListPane } from '../../../shared/ui/list-pane/ListPane';
import { ArchiveRows } from './ArchiveRows';
import '../archive.css';

export interface ArchiveListProps {
  pages: Pick<
    ArchivePages,
    | 'data'
    | 'status'
    | 'fetchFailed'
    | 'hasMore'
    | 'loadingMore'
    | 'loadMoreFailed'
    | 'loadMore'
    | 'retryMore'
    | 'reload'
  >;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  layoutRef?: (node: HTMLElement | null) => void;
}

/** The archive list is a display slot in App's shared list/detail layout; it loads its pages as it scrolls. */
export function ArchiveList({ pages, selectedId, onSelect, layoutRef }: ArchiveListProps) {
  const { t } = useTranslation();
  const tasks = pages.data?.tasks ?? [];

  return (
    <ListPane
      title={t('archive.title')}
      countText={t('archive.count', { count: pages.data?.total ?? tasks.length })}
      description={t('archive.description')}
      status={pages.status}
      fetchFailed={pages.fetchFailed}
      onRetry={pages.reload}
      layoutRef={layoutRef}
      empty={{
        icon: <ArchiveIcon aria-hidden="true" />,
        title: t('archive.empty'),
        hint: t('archive.emptyHint'),
      }}
      hasRows={tasks.length > 0}
      listLabel={t('archive.heading')}
      loadError={t('archive.loadError')}
      refreshError={t('archive.refreshError')}
      footer={
        <ArchiveListFooter
          hasMore={pages.hasMore}
          loadingMore={pages.loadingMore}
          loadMoreFailed={pages.loadMoreFailed}
          onRetry={pages.retryMore}
        />
      }
    >
      <ArchiveRows tasks={tasks} selectedId={selectedId} onSelect={onSelect} pages={pages} />
    </ListPane>
  );
}
