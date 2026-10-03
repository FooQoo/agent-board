import { useTranslation } from 'react-i18next';
import { columnLabel } from '../lib/format';
import type { ColumnName } from '../types';

export function ColumnChip({ column }: { column: ColumnName }) {
  const { t } = useTranslation();
  return <span className="column-chip">{columnLabel(column, t)}</span>;
}
