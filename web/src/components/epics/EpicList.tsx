import { LayersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProjectResourceResult } from '../../hooks/useProjectResource';
import type { Epic, EpicTaskCounts as Counts } from '../../types';
import { EpicBadge } from '../EpicBadge';
import { ListPane } from '../ListPane';
import { EpicTaskCounts } from './EpicTaskCounts';
import '../../styles/epics.css';

export interface EpicListProps {
  /** The epics of the project, or `undefined` while the board has not been read. */
  epics: Epic[] | undefined;
  /** Each epic's counts, from the same snapshot as `epics`. */
  counts: Record<string, Counts>;
  status: ProjectResourceResult<unknown>['status'];
  fetchFailed: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRetry: () => void;
  layoutRef?: (node: HTMLElement | null) => void;
}

/** Every epic of the project in ID order, with its task counts. Selecting one opens its details beside the list. */
export function EpicList({
  epics,
  counts,
  status,
  fetchFailed,
  selectedId,
  onSelect,
  onRetry,
  layoutRef,
}: EpicListProps) {
  const { t } = useTranslation();
  const rows = [...(epics ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return (
    <ListPane
      title={t('epics.title')}
      countText={t('epics.count', { count: rows.length })}
      status={status}
      fetchFailed={fetchFailed}
      onRetry={onRetry}
      layoutRef={layoutRef}
      empty={{
        icon: <LayersIcon aria-hidden="true" />,
        title: t('epics.empty'),
        hint: t('epics.emptyHint'),
      }}
      hasRows={rows.length > 0}
      listLabel={t('epics.heading')}
      loadError={t('epics.loadError')}
      refreshError={t('epics.refreshError')}
    >
      {rows.map((epic) => (
        <div className="epic-row" role="listitem" key={epic.id}>
          <button
            type="button"
            aria-pressed={selectedId === epic.id}
            onClick={() => onSelect(selectedId === epic.id ? null : epic.id)}
          >
            <span className="epic-row__top">
              <EpicBadge epic={epic} className="epic-row__badge" />
              <span className="epic-row__total">
                {counts[epic.id] === undefined
                  ? '—'
                  : t('epics.total', { count: counts[epic.id]?.total ?? 0 })}
              </span>
            </span>
            <span className="epic-row__main">
              <span className="epic-row__name" title={epic.name}>
                {epic.name}
              </span>
              <EpicTaskCounts counts={counts[epic.id]} />
            </span>
          </button>
        </div>
      ))}
    </ListPane>
  );
}
