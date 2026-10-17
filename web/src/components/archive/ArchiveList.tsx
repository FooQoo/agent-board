import { ArchiveIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ArchiveResponse } from '../../api';
import type { ProjectResourceResult } from '../../hooks/useProjectResource';
import type { Task } from '../../types';
import { AssigneeLabel } from '../AssigneeLabel';
import { EpicBadge } from '../EpicBadge';
import { ListPane } from '../ListPane';
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
    <ListPane
      title={t('archive.title')}
      countText={t('archive.count', { count: tasks.length })}
      description={t('archive.description')}
      status={status}
      fetchFailed={fetchFailed}
      onRetry={onRetry}
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
    >
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
              {task.epic && <EpicBadge epic={task.epic} className="archive-row__epic" />}
              <time
                className="archive-row__date"
                dateTime={task.archivedAt ?? undefined}
                title={task.archivedAt ?? undefined}
              >
                {task.archivedAt?.slice(0, 10) ?? '—'}
              </time>
            </span>
          </button>
        </div>
      ))}
    </ListPane>
  );
}
