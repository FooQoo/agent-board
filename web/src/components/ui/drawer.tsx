import { type CSSProperties, type PointerEvent, type ReactNode, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog as DialogPrimitive } from 'radix-ui';

/** A drag past this share of the sheet's height, or a quick flick, dismisses it. */
const DISMISS_SHARE = 0.25;
const FLICK_PX_PER_MS = 0.5;
const FLICK_MIN_PX = 24;

interface Drag {
  pointerId: number;
  startY: number;
  startTime: number;
}

/**
 * A bottom sheet on the shared Radix Dialog: modal, closed by Escape, the backdrop or the close
 * button. Dragging the top handle down moves the sheet and dismisses it past a threshold.
 */
export function Drawer({
  open,
  onOpenChange,
  identity,
  title,
  label,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  identity: string;
  title: string;
  label?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const popup = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // How far the sheet is pulled down. It stays set while a dismissed sheet slides out.
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  // Focus goes back where it was when the sheet opened; the sheet has no trigger of its own.
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;

  const height = () => popup.current?.offsetHeight || window.innerHeight;
  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is no longer active cannot be captured; the drag still follows it.
    }
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTime: event.timeStamp,
    };
    setOffset(0);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setSwiping(true);
    setOffset(Math.max(0, event.clientY - current.startY));
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setSwiping(false);
    const distance = Math.max(0, event.clientY - current.startY);
    const speed = distance / Math.max(1, event.timeStamp - current.startTime);
    const dismiss =
      !cancelled &&
      (distance > height() * DISMISS_SHARE || (speed > FLICK_PX_PER_MS && distance > FLICK_MIN_PX));
    if (dismiss) onOpenChange(false);
    else setOffset(0);
  };

  const progress = Math.min(1, offset / height());
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setOffset(0);
        onOpenChange(next);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="mobile-drawer__overlay"
          data-slot="drawer-backdrop"
          data-swiping={swiping ? '' : undefined}
          style={{ '--drawer-swipe-progress': progress } as CSSProperties}
        />
        <DialogPrimitive.Content
          ref={popup}
          className="mobile-drawer"
          data-slot="drawer-popup"
          data-swipe-direction="down"
          data-swiping={swiping ? '' : undefined}
          style={offset > 0 ? { translate: `0 ${offset}px` } : undefined}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
            returnFocus.current = null;
          }}
        >
          <div className="mobile-drawer__content" data-slot="drawer-content">
            <button
              type="button"
              className="mobile-drawer__handle"
              aria-label={t('monitor.drawer.dismiss')}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={(event) => endDrag(event, false)}
              onPointerCancel={(event) => endDrag(event, true)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  onOpenChange(false);
                }
              }}
            >
              <span className="mobile-drawer__handle-indicator" aria-hidden="true" />
            </button>
            <header className="mobile-drawer__header">
              <div className="mobile-drawer__heading">
                <p className="mobile-drawer__identity">{identity}</p>
                <DialogPrimitive.Title className="mobile-drawer__title">
                  {title}
                </DialogPrimitive.Title>
                {label}
              </div>
              <DialogPrimitive.Close
                className="mobile-drawer__close"
                aria-label={t('detail.close')}
              >
                <XIcon className="mobile-drawer__close-icon" aria-hidden="true" />
              </DialogPrimitive.Close>
            </header>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
