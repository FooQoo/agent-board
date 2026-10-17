import { useTranslation } from 'react-i18next';
import type { EpicTaskCounts as Counts } from '../../types';

const GROUPS = ['todo', 'doing', 'done', 'archived'] as const;

/**
 * The four counts of an epic, in lane order, each with its name. A count is never shown as zero when
 * it could not be read: the list shows a dash instead.
 */
export function EpicTaskCounts({ counts }: { counts: Counts | undefined }) {
  const { t } = useTranslation();
  if (counts === undefined) return <span className="epic-counts epic-counts--missing">—</span>;
  return (
    <span className="epic-counts" role="group" aria-label={t('epics.countsLabel')}>
      {GROUPS.map((group) => (
        <span key={group} className={`epic-counts__item epic-counts__item--${group}`}>
          <span className="epic-counts__name">{t(`epics.counts.${group}`)}</span>
          <span className="epic-counts__value">{counts[group]}</span>
        </span>
      ))}
    </span>
  );
}
