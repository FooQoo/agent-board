import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MonitorSection } from '../components/MonitorSectionHeader';
import { EMPTY_OVERLAY, type Lanes, applyOverlay, settleOverlay } from '../model/overlay';

/**
 * Keeps what the phone saved on screen until a read of the project catches up: a move or an archive.
 * Without it the card would jump back to where the last read had it, and then forward again when the
 * read after the save arrives. A move gives way to any newer read once its save is accepted (`settle`).
 */
export function useLaneOverlay(lanes: Lanes) {
  const [overlay, setOverlay] = useState(EMPTY_OVERLAY);
  const latest = useRef(lanes);
  latest.current = lanes;
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
      setOverlay((current) => {
        const settled = new Map(current.settled);
        settled.delete(id);
        return { ...current, moved: new Map(current.moved).set(id, target), settled };
      }),
    /** The save was accepted: the read the screen has now is the last that may predate it. */
    settle: (id: number) =>
      setOverlay((current) =>
        !current.moved.has(id) || current.settled.has(id)
          ? current
          : { ...current, settled: new Map(current.settled).set(id, latest.current) },
      ),
    /** Takes back a move the server refused: the card shows where the last read has it. */
    unmove: (id: number) =>
      setOverlay((current) => {
        if (!current.moved.has(id)) return current;
        const moved = new Map(current.moved);
        moved.delete(id);
        const settled = new Map(current.settled);
        settled.delete(id);
        return { ...current, moved, settled };
      }),
    hide: (ids: readonly number[]) =>
      setOverlay((current) => ({ ...current, hidden: new Set([...current.hidden, ...ids]) })),
  };
}
