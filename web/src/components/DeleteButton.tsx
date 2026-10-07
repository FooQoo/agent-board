import { Trash2Icon } from 'lucide-react';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

/** The trash button at the right end of the detail toolbar. */
export const DeleteButton = forwardRef<HTMLButtonElement, { onClick: () => void }>(
  function DeleteButton({ onClick }, ref) {
    const { t } = useTranslation();
    return (
      <button
        ref={ref}
        type="button"
        className="detail__tool detail__tool--delete"
        aria-label={t('delete.buttonLabel')}
        title={t('delete.buttonLabel')}
        onClick={onClick}
      >
        <Trash2Icon aria-hidden="true" />
      </button>
    );
  },
);
