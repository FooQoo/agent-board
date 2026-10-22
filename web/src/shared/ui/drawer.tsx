import { type ReactNode, useRef } from 'react';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useDrawerDrag } from './use-drawer-drag';

/**
 * A bottom sheet on the shared Radix Dialog: modal, closed by Escape, the backdrop or the close
 * button. Dragging the top handle down moves the sheet and dismisses it past a threshold; the drag is
 * painted outside React (see `useDrawerDrag`).
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
  const overlay = useRef<HTMLDivElement>(null);
  const handle = useDrawerDrag({ open, onOpenChange, popup, overlay });
  // Focus goes back where it was when the sheet opened; the sheet has no trigger of its own.
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          ref={overlay}
          className="mobile-drawer__overlay"
          data-slot="drawer-backdrop"
        />
        <DialogPrimitive.Content
          ref={popup}
          className="mobile-drawer"
          data-slot="drawer-popup"
          data-swipe-direction="down"
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
              {...handle}
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
