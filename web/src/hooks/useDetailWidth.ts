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

/**
 * The detail panel width: the width the user chose, clamped to what the current layout allows.
 * Narrowing the window never rewrites the chosen width, so widening brings it back.
 */
export function useDetailWidth(
  bodyRef: RefObject<HTMLElement | null>,
  boardReady: boolean,
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
    const lanes = body.querySelector('.board__lanes');
    const style = lanes ? window.getComputedStyle(lanes) : null;
    setLayoutMax(
      maxWidthFor({
        bodyWidth: body.getBoundingClientRect().width,
        paddingLeft: style ? px(style.paddingLeft) : 0,
        paddingRight: style ? px(style.paddingRight) : 0,
        gap: style ? px(style.columnGap) : 0,
      }),
    );
  }, [bodyRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: boardReady triggers a fresh measurement when content becomes available
  useEffect(() => {
    measure();
  }, [measure, boardReady]);

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
