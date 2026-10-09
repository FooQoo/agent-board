import { useTranslation } from 'react-i18next';
import { columnLabel } from '../lib/format';
import type { ColumnName } from '../types';
import { ArchiveIcon } from 'lucide-react';

export function LaneHeader({
  column,
  count,
  onArchive,
}: {
  column: ColumnName;
  count: number;
  onArchive?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="lane-header">
      <h2 className="lane-header__name">{columnLabel(column, t)}</h2>
      <span className="lane-header__count">{count}</span>
      {column === 'done' && onArchive && (
        <button
          type="button"
          className="lane-header__archive"
          aria-label={t('archive.bulkTitle')}
          title={t('archive.bulkTitle')}
          onClick={onArchive}
          disabled={count === 0}
        >
          <ArchiveIcon aria-hidden="true" />
        </button>
      )}
    </header>
  );
}
