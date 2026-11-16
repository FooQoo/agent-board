import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { HOLD_MS, swipeAxis, withinHoldTolerance } from './sideSwipe';

export interface SideSwipeOptions {
  /** Sideways moves slide the element only while this is true. */
  active: boolean;
  /**
   * A press held still for `holdMs` calls this. From then on the same press can slide, as if
   * `active` were already true. Leave it out when the element has no hold.
   */
  onHold?: () => void;
  holdMs?: number;
  /** A press began on the element (before it is known to be a slide). */
  onPress?: () => void;
  /** The press is sliding: `dx` px sideways from where it began. */
  onSlide: (dx: number) => void;
  /**
   * The slide ended: the distance and the speed (px/ms, negative to the left) at the end. It is
   * `cancelled` when the browser took the press away.
   */
  onRelease: (dx: number, velocity: number, cancelled: boolean) => void;
  /** Presses that start inside an element matching this selector are not read. */
  ignore?: string;
  disabled?: boolean;
}

type Phase = 'idle' | 'hold' | 'press' | 'slide';

/**
 * A sideways slide of one element, and optionally a hold that enables it. A move up or down is
 * left to the browser's scroll. While the element is active (or held), its moves are its own:
 * an outer swipe area that listens to touch or mouse events, such as a carousel, does not see
 * them. It knows nothing of what the slide means; the caller turns the distance into a position.
 */
export function useSideSwipe(ref: RefObject<HTMLElement | null>, options: SideSwipeOptions) {
  // The latest options, read by listeners that outlive a render.
  const latest = useRef(options);
  latest.current = options;
  const phase = useRef<Phase>('idle');
  // Active now: set by the hold before the caller's next render says so.
  const active = useRef(options.active);
  useEffect(() => {
    active.current = options.active;
  }, [options.active]);
  const start = useRef({ x: 0, y: 0 });
  const last = useRef({ x: 0, t: 0 });
  const velocity = useRef(0);
  const moved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // React's touch handlers are passive, so these are added by hand.
    const touch = (event: TouchEvent) => {
      if (!active.current) return;
      event.stopPropagation();
      if (phase.current === 'slide' && event.cancelable) event.preventDefault();
    };
    const mouse = (event: MouseEvent) => {
      if (active.current) event.stopPropagation();
    };
    element.addEventListener('touchmove', touch, { passive: false });
    element.addEventListener('mousemove', mouse);
    return () => {
      element.removeEventListener('touchmove', touch);
      element.removeEventListener('mousemove', mouse);
    };
  }, [ref]);

  const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    clearTimeout(timer.current);
    const was = phase.current;
    phase.current = 'idle';
    if (was === 'slide')
      latest.current.onRelease(event.clientX - start.current.x, velocity.current, cancelled);
  };

  return {
    /** True when the last press was a hold or a slide, so the click that follows is not a tap. */
    consumesClick: () => moved.current,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        const { disabled, ignore, onHold, holdMs = HOLD_MS, onPress } = latest.current;
        if (disabled || !event.isPrimary || event.button !== 0 || phase.current !== 'idle') return;
        if (ignore && (event.target as Element).closest(ignore)) return;
        start.current = { x: event.clientX, y: event.clientY };
        last.current = { x: event.clientX, t: event.timeStamp };
        velocity.current = 0;
        moved.current = false;
        onPress?.();
        if (active.current || !onHold) {
          phase.current = active.current ? 'press' : 'idle';
          return;
        }
        phase.current = 'hold';
        timer.current = setTimeout(() => {
          if (phase.current !== 'hold') return;
          phase.current = 'press';
          active.current = true;
          // The click that ends the hold is not a tap.
          moved.current = true;
          onHold();
        }, holdMs);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (phase.current === 'idle') return;
        const dx = event.clientX - start.current.x;
        const dy = event.clientY - start.current.y;
        const dt = event.timeStamp - last.current.t;
        if (dt > 0) velocity.current = (event.clientX - last.current.x) / dt;
        last.current = { x: event.clientX, t: event.timeStamp };
        if (phase.current === 'hold') {
          // Moved before the hold: the outer swipe or the browser's scroll takes the press.
          if (!withinHoldTolerance(dx, dy)) {
            clearTimeout(timer.current);
            phase.current = 'idle';
          }
          return;
        }
        if (phase.current === 'press') {
          const axis = swipeAxis(dx, dy);
          if (axis === 'y') phase.current = 'idle';
          if (axis !== 'x') return;
          phase.current = 'slide';
          moved.current = true;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // The pointer is already gone; the press ends on its own.
          }
        }
        latest.current.onSlide(dx);
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
      onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
      // A hold must not open the browser's menu.
      onContextMenu: (event: { preventDefault: () => void }) => {
        if (latest.current.onHold) event.preventDefault();
      },
    },
  };
}
