import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../dialog';
import '../../styles/lightbox.css';

/**
 * The enlarged view of a picture or a diagram: one dialog frame, the content, and a close button.
 * It is mounted only while it is open, so `onClose` is the only way it goes away.
 */
export function Lightbox({
  label,
  onClose,
  onCloseAutoFocus,
  children,
}: {
  label: string;
  onClose: () => void;
  /** Where the focus goes when the picture closes; the default is the element focused before it. */
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="lightbox"
        data-lightbox
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogTitle className="visually-hidden">{label}</DialogTitle>
        <DialogClose className="lightbox__close" aria-label={t('dialog.close')}>
          <XIcon aria-hidden="true" />
        </DialogClose>
        {children}
      </DialogContent>
    </Dialog>
  );
}
