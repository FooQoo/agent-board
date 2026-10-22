import {
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

/** A drag past this share of the sheet's height, or a quick flick, dismisses it. */
const DISMISS_SHARE = 0.25;
const FLICK_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 24;

const OFFSET_VAR = '--drawer-drag-y';
const PROGRESS_VAR = '--drawer-swipe-progress';

interface Drag {
  pointerId: number;
  startY: number;
  startTime: number;
  /** How far down the sheet already was when the drag began (a settling sheet that was caught). */
  startOffset: number;
  /** Measured once per drag, and again only when the viewport changes. */
  height: number;
  offset: number;
  frame: number | null;
  onResize(): void;
}

/**
 * Drives the swipe-down gesture of the sheet's handle without React state: the pointer only records
 * the latest position, and one animation frame writes it to the `--drawer-drag-y` property of the
 * sheet and the `--drawer-swipe-progress` property of the backdrop. The stylesheet turns those into
 * `translate` and `opacity`, so a drag renders nothing in React and reads the height once.
 */
export function useDrawerDrag({
  open,
  onOpenChange,
  popup,
  overlay,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  popup: RefObject<HTMLElement | null>;
  overlay: RefObject<HTMLElement | null>;
}) {
  const drag = useRef<Drag | null>(null);

  const measure = () => popup.current?.offsetHeight || window.innerHeight;
  const paint = (offset: number, height: number) => {
    popup.current?.style.setProperty(OFFSET_VAR, `${offset}px`);
    overlay.current?.style.setProperty(PROGRESS_VAR, String(Math.min(1, offset / height)));
  };
  const flush = (current: Drag) => {
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    current.frame = null;
    paint(current.offset, current.height);
  };
  /** Ends the drag in progress without painting anything more. */
  const stop = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    window.removeEventListener('resize', current.onResize);
    drag.current = null;
  }, []);
  /** Forgets any pull so that the sheet opens, or stays, at its resting position. */
  const reset = useCallback(() => {
    stop();
    const sheet = popup.current;
    if (sheet) {
      sheet.style.removeProperty(OFFSET_VAR);
      sheet.removeAttribute('data-swiping');
      sheet.removeAttribute('data-settling');
    }
    const backdrop = overlay.current;
    if (backdrop) {
      backdrop.style.removeProperty(PROGRESS_VAR);
      backdrop.removeAttribute('data-settling');
    }
  }, [stop, popup, overlay]);

  // A sheet that opens again, even while it is still sliding out, starts from its resting position.
  // A sheet that closes by other means ends the drag but keeps its position for the slide out.
  useLayoutEffect(() => {
    if (open) {
      reset();
      return;
    }
    stop();
    popup.current?.removeAttribute('data-swiping');
  }, [open, reset, stop, popup]);
  useEffect(() => stop, [stop]);

  const settle = () => {
    const sheet = popup.current;
    const backdrop = overlay.current;
    sheet?.removeAttribute('data-swiping');
    if (!sheet) return;
    sheet.setAttribute('data-settling', '');
    backdrop?.setAttribute('data-settling', '');
    const done = (event: TransitionEvent) => {
      if (event.target !== sheet || event.propertyName !== 'translate') return;
      sheet.removeEventListener('transitionend', done);
      sheet.removeAttribute('data-settling');
      backdrop?.removeAttribute('data-settling');
    };
    sheet.addEventListener('transitionend', done);
    paint(0, 1);
  };

  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || event.isPrimary === false || drag.current) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is no longer active cannot be captured; the drag still follows it.
    }
    const sheet = popup.current;
    const height = measure();
    let startOffset = 0;
    if (sheet?.hasAttribute('data-settling')) {
      // Catch a sheet that is still sliding back from where it is on screen.
      const rest = window.innerHeight - height;
      startOffset = Math.max(0, sheet.getBoundingClientRect().top - rest);
      sheet.removeAttribute('data-settling');
      overlay.current?.removeAttribute('data-settling');
      paint(startOffset, height);
    }
    sheet?.setAttribute('data-swiping', '');
    const onResize = () => {
      if (drag.current) drag.current.height = measure();
    };
    window.addEventListener('resize', onResize);
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTime: event.timeStamp,
      startOffset,
      height,
      offset: startOffset,
      frame: null,
      onResize,
    };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.offset = Math.max(0, current.startOffset + event.clientY - current.startY);
    if (current.frame !== null) return;
    current.frame = requestAnimationFrame(() => {
      current.frame = null;
      paint(current.offset, current.height);
    });
  };
  const end = (event: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    stop();
    current.offset = Math.max(0, current.startOffset + event.clientY - current.startY);
    flush(current);
    const moved = Math.max(0, event.clientY - current.startY);
    const speed = moved / Math.max(1, event.timeStamp - current.startTime);
    const dismiss =
      !cancelled &&
      (current.offset > current.height * DISMISS_SHARE ||
        (speed > FLICK_PX_PER_MS && moved > FLICK_MIN_PX));
    if (dismiss) {
      popup.current?.removeAttribute('data-swiping');
      onOpenChange(false);
    } else if (current.offset > 0) {
      settle();
    } else {
      popup.current?.removeAttribute('data-swiping');
    }
  };

  return {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => end(event, false),
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => end(event, true),
    onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => end(event, true),
  };
}
