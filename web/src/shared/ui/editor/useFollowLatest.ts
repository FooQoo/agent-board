import { useEffect, useRef, useState } from 'react';

/** Calls the listener when the followed item may have changed outside the editor. */
export type ChangeSubscription = (listener: () => void) => () => void;

export interface UseFollowLatestOptions<T> {
  subscribe?: ChangeSubscription;
  /** True only while the editor has no difference; the first difference stops following. */
  active: boolean;
  /** Reads the latest without a loading state; null when the read found nothing or failed. */
  load: () => Promise<T | null>;
  apply: (value: T) => void;
}

/**
 * Follows the latest of an item while the editor has no difference. Every notice reads it again,
 * and the read is applied only if it is the newest one and the editor is still without a
 * difference when it finishes. `updatedAt` is when the screen last followed a change.
 */
export function useFollowLatest<T>({ subscribe, active, load, apply }: UseFollowLatestOptions<T>): {
  updatedAt: Date | null;
} {
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const latest = useRef({ active, load, apply });
  latest.current = { active, load, apply };
  const sequence = useRef(0);

  useEffect(() => {
    if (subscribe === undefined) return;
    return subscribe(() => {
      if (!latest.current.active) return;
      const mine = ++sequence.current;
      void (async () => {
        let value: T | null;
        try {
          value = await latest.current.load();
        } catch {
          return;
        }
        if (value === null || mine !== sequence.current || !latest.current.active) return;
        latest.current.apply(value);
        setUpdatedAt(new Date());
      })();
    });
  }, [subscribe]);

  return { updatedAt };
}
