import { type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  clampPan,
  DOUBLE_TAP_SCALE,
  distance,
  IDENTITY,
  isDoubleTap,
  midpoint,
  type Point,
  type ZoomFrame,
  type ZoomState,
  zoomAt,
} from '../../lib/gesture/pinchZoom';
import { SWIPE_SLOP } from '../../lib/gesture/sideSwipe';

function firstTwo(pointers: Map<number, Point>): [Point, Point] | null {
  const [a, b] = [...pointers.values()];
  return a && b ? [a, b] : null;
}

/** The handlers a slide spreads on itself to drive the zoom of its picture. */
export interface ZoomHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onDoubleClick: (event: { clientX: number; clientY: number }) => void;
}

/**
 * Pinch, pan, and double-tap zoom for the picture in `slide`. At 1x the browser keeps the sideways
 * and vertical scrolling, and only a second finger (or a trackpad pinch) starts a zoom. Once zoomed
 * in, one finger pans the picture. A double tap (or double click) toggles between 1x and a zoom.
 * `resetKey` changing puts the picture back at 1x.
 */
export function useImageZoom(
  slide: RefObject<HTMLElement | null>,
  image: RefObject<HTMLImageElement | null>,
  resetKey: unknown,
): { zoom: ZoomState; handlers: ZoomHandlers } {
  const [zoom, setZoom] = useState<ZoomState>(IDENTITY);
  const zoomRef = useRef(zoom);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const lastTap = useRef<{ time: number; at: Point } | null>(null);

  const apply = useCallback((next: ZoomState) => {
    zoomRef.current = next;
    setZoom(next);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new key is the reset signal
  useEffect(() => {
    pinch.current = null;
    pointers.current.clear();
    lastTap.current = null;
    apply(IDENTITY);
  }, [resetKey, apply]);

  const frame = useCallback((): ZoomFrame | null => {
    const box = slide.current;
    const img = image.current;
    if (!box || !img) return null;
    const rect = box.getBoundingClientRect();
    return {
      imgW: img.offsetWidth,
      imgH: img.offsetHeight,
      cx: img.offsetLeft - box.scrollLeft + img.offsetWidth / 2,
      cy: img.offsetTop - box.scrollTop + img.offsetHeight / 2,
      viewW: rect.width,
      viewH: rect.height,
    };
  }, [slide, image]);
  const local = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = slide.current?.getBoundingClientRect();
      return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
    },
    [slide],
  );
  const toggleAt = useCallback(
    (at: Point) => {
      const f = frame();
      if (!f) return;
      const next = zoomRef.current.scale > 1 ? 1 : DOUBLE_TAP_SCALE;
      apply(zoomAt(zoomRef.current, next, at, f));
    },
    [frame, apply],
  );

  useEffect(() => {
    const box = slide.current;
    if (!box) return;
    // A trackpad pinch arrives as a wheel with ctrlKey; it must not zoom the page.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const f = frame();
      if (!f) return;
      const next = zoomRef.current.scale * Math.exp(-event.deltaY * 0.01);
      apply(zoomAt(zoomRef.current, next, local(event.clientX, event.clientY), f));
    };
    // Two fingers belong to the pinch, and a zoomed picture is panned by one: keep the browser from
    // scrolling or zooming the page with them.
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length >= 2 || zoomRef.current.scale > 1) event.preventDefault();
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    box.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      box.removeEventListener('wheel', onWheel);
      box.removeEventListener('touchmove', onTouchMove);
    };
  }, [slide, frame, local, apply]);

  const onPointerDown = (event: PointerEvent) => {
    pointers.current.set(event.pointerId, local(event.clientX, event.clientY));
    const pair = firstTwo(pointers.current);
    if (pair && pointers.current.size === 2) {
      pinch.current = { distance: distance(pair[0], pair[1]), scale: zoomRef.current.scale };
      lastTap.current = null;
    }
    if (pointers.current.size >= 2 || zoomRef.current.scale > 1) {
      try {
        slide.current?.setPointerCapture?.(event.pointerId);
      } catch {
        // The pointer is gone already; the gesture ends with it.
      }
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    const before = pointers.current.get(event.pointerId);
    if (!before) return;
    const at = local(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, at);
    const f = frame();
    if (!f) return;
    const pair = firstTwo(pointers.current);
    if (pair && pinch.current) {
      const [a, b] = pair;
      const ratio = distance(a, b) / pinch.current.distance;
      apply(zoomAt(zoomRef.current, pinch.current.scale * ratio, midpoint(a, b), f));
    } else if (pointers.current.size === 1 && zoomRef.current.scale > 1) {
      const { scale, tx, ty } = zoomRef.current;
      apply(clampPan({ scale, tx: tx + at.x - before.x, ty: ty + at.y - before.y }, f));
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = pointers.current.get(event.pointerId);
    const wasPinching = pointers.current.size >= 2;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!start || wasPinching || event.pointerType === 'mouse') return;
    const at = local(event.clientX, event.clientY);
    // A tap is a lone finger that stayed put; two quick taps toggle the zoom.
    if (Math.hypot(at.x - start.x, at.y - start.y) >= SWIPE_SLOP) return;
    if (isDoubleTap(lastTap.current, event.timeStamp, at)) {
      lastTap.current = null;
      toggleAt(at);
    } else {
      lastTap.current = { time: event.timeStamp, at };
    }
  };
  const onPointerCancel = (event: PointerEvent) => {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
  };
  const onDoubleClick = (event: { clientX: number; clientY: number }) => {
    toggleAt(local(event.clientX, event.clientY));
  };

  return {
    zoom,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick },
  };
}
