import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AcceptanceItem } from '../../../../shared/api/contracts';

/**
 * The person's checkbox choices on top of the conditions the page last read. A choice shows at once and
 * stays until the page reads the same value back; if saving fails it is dropped and `failed` is set.
 */
export function useConditionToggle(
  items: readonly AcceptanceItem[],
  save?: (conditionId: string, done: boolean) => Promise<unknown>,
) {
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);

  // A choice the latest read already shows is no longer needed.
  useEffect(() => {
    setChosen((current) => {
      const next = new Map(
        [...current].filter(([id, done]) =>
          items.some((item) => item.id === id && item.done !== done),
        ),
      );
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const shown = useMemo(
    () =>
      items.map((item) => {
        const done = chosen.get(item.id);
        return done === undefined ? item : { ...item, done };
      }),
    [items, chosen],
  );

  const change = useCallback(
    (item: AcceptanceItem, done: boolean) => {
      if (!save || busy.has(item.id)) return;
      setFailed(false);
      setChosen((current) => new Map(current).set(item.id, done));
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
    [busy, save],
  );

  return { items: shown, change, busy, failed };
}
