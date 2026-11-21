import { useCallback, useEffect, useState } from 'react';

export interface BacklogSelection {
  selecting: boolean;
  /** The picked cards that are still in the Backlog, in the order of the lane. */
  picked: number[];
  enter: () => void;
  leave: () => void;
  toggle: (id: number) => void;
}

/**
 * The selection mode of the Backlog lane, the same shape as the bulk archive's: a mode that is
 * entered and left, and a set of picked cards. A card that left the Backlog (sent from another
 * screen, or by an agent's change) is no longer picked.
 */
export function useBacklogSelection(backlogIds: readonly number[]): BacklogSelection {
  const [selecting, setSelecting] = useState(false);
  const [raw, setRaw] = useState<number[]>([]);
  const picked = backlogIds.filter((id) => raw.includes(id));
  // Once every picked card has left the Backlog (they were sent), the mode ends.
  const sentAll = raw.length > 0 && picked.length === 0;
  useEffect(() => {
    if (sentAll) {
      setSelecting(false);
      setRaw([]);
    }
  }, [sentAll]);
  const enter = useCallback(() => setSelecting(true), []);
  const leave = useCallback(() => {
    setSelecting(false);
    setRaw([]);
  }, []);
  const toggle = useCallback(
    (id: number) =>
      setRaw((now) => (now.includes(id) ? now.filter((i) => i !== id) : [...now, id])),
    [],
  );
  return { selecting: selecting && backlogIds.length > 0, picked, enter, leave, toggle };
}
