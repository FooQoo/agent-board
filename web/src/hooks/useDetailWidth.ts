import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  DEFAULT_WIDTH,
  clampWidth,
  maxWidthFor,
  readStoredWidth,
  writeStoredWidth,
} from '../lib/detailWidth';

export interface DetailWidth {
  width: number;
  startDrag: (clientX: number) => void;
  moveDrag: (clientX: number) => void;
  endDrag: () => void;
}

const px = (value: string) => Number.parseFloat(value) || 0;

/** The padding and column gap of `.board__lanes` in app.css, for the states that show no lanes. */
const LANES_PADDING = 24;
const LANES_GAP = 16;

/**
 * The detail panel width: the width the user chose, clamped to what the current layout allows.
 * Narrowing the window never rewrites the chosen width, so widening brings it back.
 */
export function useDetailWidth(
  bodyRef: RefObject<HTMLElement | null>,
  layoutRef: RefObject<HTMLElement | null>,
  /** Changes when the content of the body changes (the lanes appear, a state message takes their place). */
  contentKey: string | boolean,
  /** The columns beside the detail panel that keep their minimum width: three lanes on the board, one list on the epic list. */
  lanes = 3,
): DetailWidth {
  const [preferred, setPreferred] = useState(() => readStoredWidth() ?? DEFAULT_WIDTH);
  const [layoutMax, setLayoutMax] = useState(Number.POSITIVE_INFINITY);
  const preferredRef = useRef(preferred);
  const layoutMaxRef = useRef(layoutMax);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  preferredRef.current = preferred;
  layoutMaxRef.current = layoutMax;

  const measure = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const layout = layoutRef.current;
    const style = layout ? window.getComputedStyle(layout) : null;
    // A state message shows no lanes; it keeps the width the lanes would leave, so the panel does not jump.
    setLayoutMax(
      maxWidthFor(
        {
          bodyWidth: body.getBoundingClientRect().width,
          paddingLeft: style ? px(style.paddingLeft) : LANES_PADDING,
          paddingRight: style ? px(style.paddingRight) : LANES_PADDING,
          gap: style ? px(style.columnGap) : LANES_GAP,
        },
        lanes,
      ),
    );
  }, [bodyRef, layoutRef, lanes]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey triggers a fresh measurement when the content changes
  useEffect(() => {
    measure();
  }, [measure, contentKey]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    const body = bodyRef.current;
    const observer =
      typeof ResizeObserver === 'undefined' || !body ? null : new ResizeObserver(measure);
    if (observer && body) observer.observe(body);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure, bodyRef]);

  const startDrag = useCallback((clientX: number) => {
    drag.current = {
      startX: clientX,
      startWidth: clampWidth(preferredRef.current, layoutMaxRef.current),
    };
    document.body.classList.add('is-resizing');
  }, []);

  const moveDrag = useCallback((clientX: number) => {
    const current = drag.current;
    if (!current) return;
    const next = clampWidth(current.startWidth + (current.startX - clientX), layoutMaxRef.current);
    preferredRef.current = next;
    setPreferred(next);
  }, []);

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    document.body.classList.remove('is-resizing');
    writeStoredWidth(preferredRef.current);
  }, []);

  useEffect(() => () => document.body.classList.remove('is-resizing'), []);

  return { width: clampWidth(preferred, layoutMax), startDrag, moveDrag, endDrag };
}
