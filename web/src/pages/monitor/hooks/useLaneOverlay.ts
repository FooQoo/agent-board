import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MonitorSection } from '../components/MonitorSectionHeader';
import { EMPTY_OVERLAY, type Lanes, applyOverlay, settleOverlay } from '../model/overlay';

/**
 * Keeps what the phone saved on screen until a read of the project shows it: a move or an archive. Without it the card would jump back to where the last read had it, and then forward
 * again when the read after the save arrives.
 */
export function useLaneOverlay(lanes: Lanes) {
  const [overlay, setOverlay] = useState(EMPTY_OVERLAY);
  useEffect(() => setOverlay((current) => settleOverlay(lanes, current)), [lanes]);
  const shown = useMemo(
    () => applyOverlay(lanes, overlay, new Date().toISOString()),
    [lanes, overlay],
  );
  // A restored task must show again even if no applied read has dropped it from `hidden` yet.
  const unhide = useCallback(
    (id: number) =>
      setOverlay((current) => {
        if (!current.hidden.has(id)) return current;
        const hidden = new Set(current.hidden);
        hidden.delete(id);
        return { ...current, hidden };
      }),
    [],
  );
  return {
    lanes: shown,
    unhide,
    move: (id: number, target: MonitorSection) =>
      setOverlay((current) => ({ ...current, moved: new Map(current.moved).set(id, target) })),
    /** Takes back a move the server refused: the card shows where the last read has it. */
    unmove: (id: number) =>
      setOverlay((current) => {
        if (!current.moved.has(id)) return current;
        const moved = new Map(current.moved);
        moved.delete(id);
        return { ...current, moved };
      }),
    hide: (ids: readonly number[]) =>
      setOverlay((current) => ({ ...current, hidden: new Set([...current.hidden, ...ids]) })),
  };
}
