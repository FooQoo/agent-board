import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskSummary } from '../../shared/api/contracts';
import { type MovedCards, markSettled, settleMoved, showMoved } from './movedCards';

const NONE: TaskSummary[] = [];

/**
 * Shows a card a person moved in its new lane at once, before the server has answered. While the save
 * is in flight the entry stays against any read. After the save (`settleCard`) the first newer read
 * wins whatever lane it shows, and the entry also goes when the server refused (`unmoveCard`).
 */
export function useMovedCards(readTasks: TaskSummary[] | undefined) {
  const read = readTasks ?? NONE;
  const [moved, setMoved] = useState<MovedCards>(() => new Map());
  const latest = useRef(read);
  latest.current = read;
  const tasks = useMemo(() => showMoved(read, moved), [read, moved]);
  useEffect(() => {
    setMoved((current) => settleMoved(current, read));
  }, [read]);
  const moveCard = useCallback(
    (id: number, to: TaskSummary['taskStatus']) =>
      setMoved((current) => new Map(current).set(id, { to, settledAt: null })),
    [],
  );
  const settleCard = useCallback(
    (id: number) => setMoved((current) => markSettled(current, id, latest.current)),
    [],
  );
  const unmoveCard = useCallback(
    (id: number) =>
      setMoved((current) => {
        if (!current.has(id)) return current;
        const next = new Map(current);
        next.delete(id);
        return next;
      }),
    [],
  );
  return { tasks, moveCard, settleCard, unmoveCard };
}
