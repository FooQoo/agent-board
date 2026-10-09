import { Trash2Icon } from 'lucide-react';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

/** The trash button at the right end of the detail toolbar. */
export const DeleteButton = forwardRef<
  HTMLButtonElement,
  { onClick: () => void; action?: 'archive' | 'delete'; disabled?: boolean }
>(function DeleteButton({ onClick, action = 'delete', disabled = false }, ref) {
  const { t } = useTranslation();
  return (
    <button
      ref={ref}
      type="button"
      className="detail__tool detail__tool--delete"
      aria-label={t(action === 'archive' ? 'archive.buttonLabel' : 'delete.buttonLabel')}
      title={t(action === 'archive' ? 'archive.buttonLabel' : 'delete.buttonLabel')}
      disabled={disabled}
      onClick={onClick}
    >
      <Trash2Icon aria-hidden="true" />
    </button>
  );
});
