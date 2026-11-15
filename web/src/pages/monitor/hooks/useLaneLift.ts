import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MonitorTask } from '../contracts';
import type { MonitorSection } from '../components/MonitorSectionHeader';
import { EDGE_DWELL_MS, type Edge, dwellEdge, edgeOf, edgeTarget } from '../model/lanes';
import type { Point } from './useCardGesture';

/** A card that is held up and carried. Coordinates are relative to the lanes viewport. */
export interface Lift {
  item: MonitorTask;
  source: MonitorSection;
  /** Where the finger is, and where inside the card it took hold. */
  pointer: Point;
  grab: Point;
  /** The card's width when it was lifted; null lets the ghost fill the viewport. */
  width: number | null;
  /** The edge strip the finger is in, if any. */
  edge: Edge | null;
  /** A story's still picture of a lift: nothing moves and the lane never changes. */
  frozen?: boolean;
}

/**
 * The lift of a card: its position, the edge strip the finger rests in, and the dwell that turns
 * a rest at the edge into a lane change. `lane` is the lane on screen. When the lift ends the card
 * is dropped into that lane; `onMove` runs only when that is not the lane it came from.
 */
export function useLaneLift(
  viewport: RefObject<HTMLElement | null>,
  {
    lane,
    onLaneChange,
    onMove,
    initial,
  }: {
    lane: MonitorSection;
    onLaneChange: (lane: MonitorSection) => void;
    onMove: (item: MonitorTask, target: MonitorSection) => void;
    initial?: Lift | null;
  },
) {
  const [lift, setLift] = useState<Lift | null>(initial ?? null);
  // False right after a dwell changed the lane: the finger must leave the strip before the next one.
  const armed = useRef(true);

  const relative = (point: Point) => {
    const rect = viewport.current?.getBoundingClientRect();
    return {
      x: point.x - (rect?.left ?? 0),
      y: point.y - (rect?.top ?? 0),
      width: rect?.width ?? 0,
    };
  };

  const edge = lift?.edge ?? null;
  const frozen = lift?.frozen ?? false;
  const lifted = lift !== null;
  useEffect(() => {
    if (!lifted || frozen) return;
    const state = dwellEdge(lane, edge, armed.current);
    armed.current = state.armed;
    const target = edgeTarget(lane, state.edge);
    if (!state.run || !target) return;
    const timer = setTimeout(() => {
      armed.current = false;
      onLaneChange(target);
    }, EDGE_DWELL_MS);
    return () => clearTimeout(timer);
  }, [lifted, frozen, lane, edge, onLaneChange]);

  return {
    lift,
    start: (
      item: MonitorTask,
      source: MonitorSection,
      point: Point,
      grab: Point,
      width: number,
    ) => {
      armed.current = true;
      const at = relative(point);
      setLift({
        item,
        source,
        pointer: at,
        grab,
        width,
        edge: edgeOf(at.x, at.width),
      });
    },
    move: (point: Point) => {
      const at = relative(point);
      setLift((current) =>
        current && !current.frozen
          ? { ...current, pointer: at, edge: edgeOf(at.x, at.width) }
          : current,
      );
    },
    end: (cancelled: boolean) => {
      const was = lift;
      setLift(null);
      if (!was || was.frozen || cancelled) return;
      if (was.source !== lane) onMove(was.item, lane);
    },
  };
}
