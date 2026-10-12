import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useRef } from 'react';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from './dialog';

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
  const startY = useRef<number | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    startY.current = event.clientY;
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (startY.current !== null && event.clientY - startY.current > 64) onOpenChange(false);
    startY.current = null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="mobile-drawer"
        style={{ translate: 'none' }}
        overlayClassName="mobile-drawer__overlay"
        aria-describedby={undefined}
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          returnFocus.current = active instanceof HTMLElement ? active : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
          returnFocus.current = null;
        }}
      >
        <button
          type="button"
          className="mobile-drawer__handle"
          aria-label={t('monitor.drawer.dismiss')}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            startY.current = null;
          }}
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
            <DialogTitle className="mobile-drawer__title">{title}</DialogTitle>
            {label}
          </div>
          <button
            type="button"
            className="mobile-drawer__close"
            aria-label={t('detail.close')}
            onClick={() => onOpenChange(false)}
          >
            <XIcon className="mobile-drawer__close-icon" aria-hidden="true" />
          </button>
        </header>
        {children}
      </DialogContent>
    </Dialog>
  );
}
