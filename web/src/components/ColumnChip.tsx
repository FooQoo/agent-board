import type { ColumnName } from '../types';
import { StatusLabel } from './StatusLabel';

export function ColumnChip({ column }: { column: ColumnName }) {
  return <StatusLabel kind="card" status={column} />;
}
