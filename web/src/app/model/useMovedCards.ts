import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskSummary } from '../../shared/api/contracts';

const NONE: TaskSummary[] = [];

/**
 * Shows a card a person moved in its new lane at once, before the server has answered. The entry goes
 * once the board read shows the card in that lane, or when the server refused (`unmoveCard`).
 */
export function useMovedCards(readTasks: TaskSummary[] | undefined) {
  const read = readTasks ?? NONE;
  const [moved, setMoved] = useState<ReadonlyMap<number, TaskSummary['taskStatus']>>(
    () => new Map(),
  );
  const tasks = useMemo(
    () =>
      moved.size === 0
        ? read
        : read.map((task) => {
            const to = moved.get(task.id);
            return to === undefined ? task : { ...task, taskStatus: to };
          }),
    [read, moved],
  );
  useEffect(() => {
    setMoved((current) => {
      const waiting = [...current].filter(([id, to]) =>
        read.some((task) => task.id === id && task.taskStatus !== to),
      );
      return waiting.length === current.size ? current : new Map(waiting);
    });
  }, [read]);
  const moveCard = useCallback(
    (id: number, to: TaskSummary['taskStatus']) =>
      setMoved((current) => new Map(current).set(id, to)),
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
  return { tasks, moveCard, unmoveCard };
}
