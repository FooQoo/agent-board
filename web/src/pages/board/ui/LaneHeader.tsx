import { useTranslation } from 'react-i18next';
import { columnLabel } from '../../../features/tasks/model/format';
import type { ColumnName } from '../../../shared/api/contracts';
import { ArchiveIcon, ListChecksIcon, XIcon } from 'lucide-react';
import '../../../shared/styles/backlog.css';

export function LaneHeader({
  column,
  count,
  onArchive,
  selecting,
  onToggleSelect,
}: {
  column: ColumnName;
  count: number;
  onArchive?: () => void;
  /** The Backlog lane: the selection mode is on. */
  selecting?: boolean;
  /** The Backlog lane: the button that enters and leaves the selection mode. */
  onToggleSelect?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="lane-header">
      <h2 className="lane-header__name">{columnLabel(column, t)}</h2>
      <span className="lane-header__count">{count}</span>
      {column === 'backlog' && onToggleSelect && (
        <button
          type="button"
          className="lane-header__select"
          aria-label={selecting ? t('backlog.exitSelect') : t('backlog.select')}
          title={selecting ? t('backlog.exitSelect') : t('backlog.select')}
          aria-pressed={selecting}
          onClick={onToggleSelect}
          disabled={count === 0}
        >
          {selecting ? <XIcon aria-hidden="true" /> : <ListChecksIcon aria-hidden="true" />}
        </button>
      )}
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
