import { useTranslation } from 'react-i18next';
import { columnLabel } from '../lib/format';
import type { ColumnName } from '../types';

export function LaneHeader({ column, count }: { column: ColumnName; count: number }) {
  const { t } = useTranslation();
  return (
    <header className="lane-header">
      <div className="lane-header__title">
        <span className="dot" data-column={column} aria-hidden="true" />
        <h2 className="lane-header__name">{columnLabel(column, t)}</h2>
        <span className="lane-header__count">{count}</span>
      </div>
      <div className="rule rule--lane" aria-hidden="true">
        <span className="rule__line" />
        <span className="rule__end" />
      </div>
    </header>
  );
}
