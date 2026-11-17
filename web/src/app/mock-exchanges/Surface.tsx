import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog';
import { Drawer } from '@/shared/ui/drawer';
import '../../shared/styles/modal.css';
import './exchanges-mock.css';
import { useMockText } from './text';

/**
 * Where a mock screen opens: a modal on the desktop board, a bottom sheet on a phone. The body scrolls
 * and the footer (the buttons) stays in view.
 */
export function Surface({
  kind,
  title,
  identity,
  onClose,
  footer,
  className = '',
  children,
}: {
  kind: 'dialog' | 'sheet';
  title: string;
  /** The small line above the title of a sheet. */
  identity?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const m = useMockText();
  if (kind === 'sheet') {
    return (
      <Drawer
        open
        onOpenChange={(open) => !open && onClose()}
        identity={identity ?? ''}
        title={title}
        closeLabel={m.close}
        className={`xsheet ${className}`.trim()}
      >
        <div className="xsurface__body">{children}</div>
        {footer && <div className="xsurface__footer">{footer}</div>}
      </Drawer>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`modal xmodal ${className}`.trim()}
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <div className="modal__header">
          <DialogTitle className="modal__title">{title}</DialogTitle>
          <button type="button" className="modal__close" aria-label={m.close} onClick={onClose}>
            <XIcon aria-hidden="true" />
          </button>
        </div>
        <div className="xsurface__body">{children}</div>
        {footer && <div className="xsurface__footer">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
