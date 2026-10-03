import { columnLabel } from '../lib/format';
import type { ColumnName } from '../types';

export function ColumnChip({ column }: { column: ColumnName }) {
  return <span className="column-chip">{columnLabel(column)}</span>;
}
