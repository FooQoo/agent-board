import { compareArchivedNewestFirst } from '../../../features/tasks/api/archiveOrder.ts';

interface Archived {
  id: number;
  archivedAt?: string | null;
}

/** The cursor the mock hands out: the last row's archive time and id, as the real server's is. */
export const archiveCursorOf = (row: Archived): string => btoa(`${row.archivedAt ?? ''}|${row.id}`);

function rowOf(cursor: string): Archived | null {
  try {
    const [archivedAt = '', id = ''] = atob(cursor).split('|');
    return Number.isInteger(Number(id)) && id !== ''
      ? { id: Number(id), archivedAt: archivedAt || null }
      : null;
  } catch {
    return null;
  }
}

/** One page of the archive, newest first and keyset-based like the server's, for the mock and test backends. */
export function pageArchive<T extends Archived>(
  tasks: readonly T[],
  limit: number,
  cursor: string | null,
): { tasks: T[]; nextCursor: string | null; total: number } {
  const sorted = [...tasks].sort(compareArchivedNewestFirst);
  const after = cursor === null ? null : rowOf(cursor);
  const rest = after ? sorted.filter((row) => compareArchivedNewestFirst(after, row) < 0) : sorted;
  const page = rest.slice(0, limit);
  const last = page.at(-1);
  return {
    tasks: page,
    nextCursor: rest.length > limit && last ? archiveCursorOf(last) : null,
    total: sorted.length,
  };
}
