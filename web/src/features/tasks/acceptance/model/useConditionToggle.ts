import { useCallback, useMemo, useState } from 'react';
import type { AcceptanceItem } from '../../../../shared/api/contracts';

/** A person's choice, with the value the page showed when they made it. */
interface Choice {
  done: boolean;
  from: boolean;
}

/**
 * The person's checkbox choices on top of the conditions the page last read. A choice shows at once and
 * only while the page still reads the value it was made over: once the saved value (or anyone else's
 * change) arrives, the read value shows again. If saving fails the choice is dropped and `failed` is set.
 */
export function useConditionToggle(
  items: readonly AcceptanceItem[],
  save?: (conditionId: string, done: boolean) => Promise<unknown>,
) {
  const [chosen, setChosen] = useState<ReadonlyMap<string, Choice>>(new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);

  const shown = useMemo(
    () =>
      items.map((item) => {
        const choice = chosen.get(item.id);
        return choice && choice.from === item.done ? { ...item, done: choice.done } : item;
      }),
    [items, chosen],
  );

  const change = useCallback(
    (item: AcceptanceItem, done: boolean) => {
      if (!save || busy.has(item.id)) return;
      const from = items.find((read) => read.id === item.id)?.done ?? item.done;
      setFailed(false);
      setChosen((current) => new Map(current).set(item.id, { done, from }));
      setBusy((current) => new Set(current).add(item.id));
      save(item.id, done)
        .catch(() => {
          setChosen((current) => {
            const next = new Map(current);
            next.delete(item.id);
            return next;
          });
          setFailed(true);
        })
        .finally(() => {
          setBusy((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
        });
    },
    [busy, items, save],
  );

  return { items: shown, change, busy, failed };
}
