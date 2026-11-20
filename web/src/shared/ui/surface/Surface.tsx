import { XIcon } from 'lucide-react';
import { type ReactNode, type Ref, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../dialog';
import { Drawer } from '../drawer';
import '../../styles/modal.css';
import './surface.css';

/**
 * A screen that opens above the board: a modal on the desktop, a bottom sheet on a phone. The body
 * scrolls, and the footer (the buttons) stays in view.
 */
export function Surface({
  kind,
  title,
  closeLabel,
  identity,
  badge,
  onClose,
  footer,
  className = '',
  dismissible = true,
  bodyRef,
  children,
}: {
  kind: 'dialog' | 'sheet';
  title: string;
  /** The accessible name of the close button. */
  closeLabel: string;
  /** The small line above the title of a sheet. */
  identity?: ReactNode;
  /** A small label beside the title, such as the public preview badge. */
  badge?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
  /** A sheet that cannot be dragged away while a save blocks closing. */
  dismissible?: boolean;
  /** The scrolling body, for a list that draws only the rows in view. */
  bodyRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  // Where the focus was when the dialog opened (the button that opened it).
  const [opener] = useState(() => document.activeElement);
  if (kind === 'sheet') {
    return (
      <Drawer
        open
        onOpenChange={(open) => !open && onClose()}
        identity={identity ?? ''}
        title={title}
        label={badge}
        closeLabel={closeLabel}
        className={`surface-sheet ${className}`.trim()}
        initialFocusSelector=".surface__body"
        fitKeyboard
        dismissible={dismissible}
      >
        <div className="surface__body" tabIndex={-1} ref={bodyRef}>
          {children}
        </div>
        {footer && <div className="surface__footer">{footer}</div>}
      </Drawer>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`modal surface-modal ${className}`.trim()}
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // The dialog itself takes the focus, so no button shows a ring on open.
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement)
            event.currentTarget.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          // The dialog has no trigger of its own: focus goes back to the button that opened it.
          event.preventDefault();
          if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
            opener.focus();
          }
        }}
      >
        <div className="modal__header">
          {badge ? (
            <div className="surface__heading">
              <DialogTitle className="modal__title">{title}</DialogTitle>
              {badge}
            </div>
          ) : (
            <DialogTitle className="modal__title">{title}</DialogTitle>
          )}
          <button type="button" className="modal__close" aria-label={closeLabel} onClick={onClose}>
            <XIcon aria-hidden="true" />
          </button>
        </div>
        <div className="surface__body" ref={bodyRef}>
          {children}
        </div>
        {footer && <div className="surface__footer">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
