import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const DeleteButton = forwardRef<HTMLButtonElement, { onClick: () => void }>(
  function DeleteButton({ onClick }, ref) {
    const { t } = useTranslation();
    return (
      <Button
        ref={ref}
        type="button"
        variant="outline"
        size="icon"
        className="delete-button"
        aria-label={t('delete.buttonLabel')}
        onClick={onClick}
      >
        <Trash2Icon aria-hidden="true" />
      </Button>
    );
  },
);
