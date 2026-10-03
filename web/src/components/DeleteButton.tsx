import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash } from './icons';

export const DeleteButton = forwardRef<HTMLButtonElement, { onClick: () => void }>(
  function DeleteButton({ onClick }, ref) {
    const { t } = useTranslation();
    return (
      <button
        ref={ref}
        type="button"
        className="delete-button"
        aria-label={t('delete.buttonLabel')}
        onClick={onClick}
      >
        <Trash />
      </button>
    );
  },
);
