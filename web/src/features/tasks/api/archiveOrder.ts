// No imports, so the sample-data server (loaded by the Vite config) can use it.
/**
 * The archive list's order: newest `archivedAt` first, a card without a readable archive time after
 * all the others, and the higher id first when times are equal. The server sends this order; the
 * page applies it again so a list built from several pages never depends on how they arrived.
 */
export function compareArchivedNewestFirst(
  a: { id: number; archivedAt?: string | null },
  b: { id: number; archivedAt?: string | null },
): number {
  const time = (task: { archivedAt?: string | null }) =>
    task.archivedAt ? Date.parse(task.archivedAt) : Number.NaN;
  const left = time(a);
  const right = time(b);
  const leftKnown = !Number.isNaN(left);
  const rightKnown = !Number.isNaN(right);
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  if (leftKnown && left !== right) return right - left;
  return b.id - a.id;
}
